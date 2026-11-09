import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { canonical, jsonBytes, sha256 } from './context.mjs';
import { MetadataStore } from './metadata.mjs';
import { verifyImage as verifyConsumerImage, bytes } from './registry.mjs';
import { environmentEvidence } from './gate.mjs';
import { releaseFiles } from './assets.mjs';
import { promotion, releaseCandidate, validateConfig } from './model.mjs';

export const publicUrl = (config, ref, path) => `https://raw.githubusercontent.com/${config.repository}/${ref}/${path}`;

export async function consumerFile(url, expected, { request = fetch, wait = ms => new Promise(done => setTimeout(done, ms)), attempts = 6 } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Release file unavailable: HTTP ${response.status}.`); }
      const data = await bytes(response, 32 * 1024 * 1024);
      if (sha256(data) !== sha256(expected)) throw new Error('Consumer release file differs from retained bytes.');
      return;
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await wait(1000 * 2 ** attempt);
    }
  }
  throw last;
}

/** Retention and announcement are separate fast-forward transactions. */
export async function publishRelease({ config, release, store,
  verifyImage = verifyConsumerImage, verifyFile = consumerFile }) {
  validateConfig(config);
  const descriptor = release.descriptor;
  const artifact = descriptor.artifacts[0];
  const observed = await verifyImage(artifact.repository, artifact.digest, config.platforms,
    { sourceCommit: descriptor.sourceCommit, sourceRepository: `https://github.com/${config.repository}` });
  if (observed.digest !== artifact.digest || canonical(observed.platforms) !== canonical(config.platforms)) throw new Error('Incomplete consumer image evidence.');
  const prefix = `releases/${descriptor.releaseId}/`;
  const content = new Map([['manifest.json', jsonBytes(release.manifest)], ...release.files.map(file => [file.path, file.data])]);
  let retainedDescriptor = descriptor;
  const metadataCommit = await store.update(`retain ${descriptor.releaseId}`, head => {
    const existing = store.json(head, prefix + 'release.json');
    if (existing) {
      const { validation: _oldValidation, build: _oldBuild, ...oldIdentity } = existing;
      const { validation: _newValidation, build: _newBuild, ...newIdentity } = descriptor;
      if (canonical(oldIdentity) !== canonical(newIdentity)) throw new Error('Immutable release identity collision.');
      for (const [path, value] of content) {
        const previous = store.read(head, prefix + path);
        if (previous === null || sha256(previous) !== sha256(value)) throw new Error('Retained release is incomplete or changed.');
      }
      retainedDescriptor = existing;
      return {};
    }
    return Object.fromEntries([...content, ['release.json', jsonBytes(descriptor)]]
      .map(([path, value]) => [prefix + path, { value, immutable: true }]));
  });
  const retainedBytes = jsonBytes(retainedDescriptor);
  for (const [path, value] of [...content, ['release.json', retainedBytes]]) {
    await verifyFile(publicUrl(config, metadataCommit, prefix + path), value);
  }
  const manifestRef = publicUrl(config, metadataCommit, prefix + 'manifest.json');
  let outcome = 'advance';
  const feedCommit = await store.update(`promote stable ${descriptor.releaseId}`, head => {
    const current = store.json(head, 'feed-state.json');
    const priorFeeds = store.json(head, 'feeds.json');
    if (Boolean(current) !== Boolean(priorFeeds) || (current && (priorFeeds.schemaVersion !== 'app-feeds.0.1'
      || priorFeeds.appId !== config.appId || priorFeeds.feeds?.length !== 1 || priorFeeds.feeds[0].id !== config.feedId
      || priorFeeds.feeds[0].default !== true || priorFeeds.feeds[0].manifestRef !== current.manifestRef))) throw new Error('Feed document and retained state disagree.');
    outcome = promotion(current, descriptor, (before, after) => store.ancestor(before, after));
    if (outcome !== 'advance') return {};
    const feeds = { schemaVersion: 'app-feeds.0.1', appId: config.appId,
      feeds: [{ id: config.feedId, manifestRef, default: true }] };
    const state = { schemaVersion: 'trading-lab-feed-state.0.1', releaseId: descriptor.releaseId,
      sourceCommit: descriptor.sourceCommit, metadataCommit, manifestRef };
    const receipt = { schemaVersion: 'trading-lab-promotion.0.1', feedId: config.feedId,
      previousReleaseId: current?.releaseId ?? null, ...state, validation: retainedDescriptor.validation, build: retainedDescriptor.build };
    return { 'feeds.json': { value: feeds }, 'feed-state.json': { value: state },
      'install.json': { value: { schemaVersion: 'trading-lab-install.0.1', appId: config.appId,
        feedsUrl: publicUrl(config, config.metadataBranch, 'feeds.json'), defaultFeedId: config.feedId, manifestRef } },
      [`promotions/${descriptor.releaseId}.json`]: { value: receipt, immutable: true } };
  });
  const publishedFeeds = store.read(feedCommit, 'feeds.json');
  if (!publishedFeeds) throw new Error('No public feed was retained.');
  await verifyFile(publicUrl(config, feedCommit, 'feeds.json'), publishedFeeds);
  return { releaseId: descriptor.releaseId, sourceCommit: descriptor.sourceCommit, outcome, metadataCommit, feedCommit,
    feedsUrl: publicUrl(config, config.metadataBranch, 'feeds.json') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = validateConfig(JSON.parse(readFileSync('distribution/release-publisher.json', 'utf8')));
  const validation = await environmentEvidence(config);
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== validation.sourceCommit || git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Publisher checkout is dirty or differs from validated CI.');
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const build = { workflow: '.github/workflows/release.yml', sourceCommit: validation.sourceCommit,
    runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    url: `https://github.com/${config.repository}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}` };
  const release = releaseCandidate({ config, manifest, sourceCommit: validation.sourceCommit,
    imageDigest: process.env.IMAGE_DIGEST, validation, build, files: releaseFiles(process.cwd(), manifest) });
  const result = await publishRelease({ config, release, store: new MetadataStore(process.cwd(), config.metadataBranch) });
  console.log(JSON.stringify(result));
}
