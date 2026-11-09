import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Exercise the native ESM tools through the same entry points used by CI.
const { releaseCandidate, promotion } = await import(new URL('../scripts/releases/model.mjs', import.meta.url).href);
const { qualifyCi, trustedRun } = await import(new URL('../scripts/releases/gate.mjs', import.meta.url).href);
const { publishRelease, consumerFile } = await import(new URL('../scripts/releases/publish.mjs', import.meta.url).href);
const { MetadataStore } = await import(new URL('../scripts/releases/metadata.mjs', import.meta.url).href);
const { releaseFiles } = await import(new URL('../scripts/releases/assets.mjs', import.meta.url).href);
const { canonical, jsonBytes, sha256 } = await import(new URL('../scripts/releases/context.mjs', import.meta.url).href);
const config = JSON.parse(readFileSync(new URL('../distribution/release-publisher.json', import.meta.url), 'utf8'));
const source = 'a'.repeat(40), nextSource = 'b'.repeat(40), imageDigest = 'sha256:' + 'c'.repeat(64);
const validation = { repository: config.repository, sourceCommit: source, workflow: config.ciWorkflow,
  runId: 12, runAttempt: 1, jobId: 4, jobName: config.ciJob };
const build = { sourceCommit: source, workflow: '.github/workflows/release.yml', runId: 13, runAttempt: 1 };
const manifest = {
  schemaVersion: 'app.0.1', id: config.appId, version: '0.2.0', defaultRuntime: 'docker',
  runtimeProfiles: [{ key: 'docker', type: 'docker', default: true }, { key: 'dev', type: 'docker', development: true }],
  services: [{ key: 'web', runtimes: { docker: { type: 'docker', image: { repository: config.imageRepository, tag: '0.2.0' } },
    dev: { type: 'docker', image: { repository: 'node', tag: '24' }, artifact: 'source', sourceMount: { path: '.' } } } }],
  data: { enabled: true, targets: [{ runtime: 'docker' }, { runtime: 'dev' }] }
};
function candidate(overrides: Record<string, unknown> = {}) {
  return releaseCandidate({ config, manifest, sourceCommit: source, imageDigest, validation, build,
    files: [{ path: 'assets/icon.svg', data: Buffer.from('<svg/>') }], ...overrides });
}
function trigger(overrides: Record<string, unknown> = {}) {
  return { repository: { full_name: config.repository }, workflow_run: { id: 12, run_attempt: 1, name: 'CI',
    head_sha: source, head_branch: 'main', head_repository: { full_name: config.repository },
    event: 'push', status: 'completed', conclusion: 'success', path: config.ciWorkflow, ...overrides } };
}

test('publication refuses PR, fork, wrong workflow and incomplete or failed CI evidence', async () => {
  for (const change of [{ event: 'pull_request' }, { head_branch: 'feature' }, { conclusion: 'failure' },
    { status: 'in_progress' }, { head_sha: 'short' }, { head_repository: { full_name: 'other/fork' } }, { name: 'Other CI' }]) {
    assert.throws(() => trustedRun(trigger(change), config));
  }
  assert.throws(() => trustedRun(trigger(), config, 'workflow_dispatch'));
  for (const runChange of [{ head_sha: nextSource }, { run_attempt: 2 }, { path: '.github/workflows/other.yml' }]) {
    await assert.rejects(qualifyCi(trigger(), config, { request: async () => trigger(runChange).workflow_run }));
  }
  for (const jobs of [[], [{ name: 'ci-required', status: 'completed', conclusion: 'skipped' }],
    [{ name: 'other', status: 'completed', conclusion: 'success' }],
    [{ name: 'ci-required', status: 'completed', conclusion: 'success' }, { name: 'image', status: 'completed', conclusion: 'failure' }]]) {
    await assert.rejects(qualifyCi(trigger(), config, { request: async (path: string) => path.includes('/jobs?')
      ? { total_count: jobs.length, jobs } : trigger().workflow_run }));
  }
});

test('CI qualification preserves exact run attempt and successful required job', async () => {
  const paths: string[] = [];
  const result = await qualifyCi(trigger(), config, { request: async (path: string) => {
    paths.push(path);
    return path.includes('/jobs?') ? { total_count: 1, jobs: [{ id: 4, name: 'ci-required', status: 'completed', conclusion: 'success' }] } : trigger().workflow_run;
  } });
  assert.equal(result.sourceCommit, source);
  assert.equal(result.runId, 12);
  assert.equal(result.runAttempt, 1);
  assert.equal(result.jobId, 4);
  assert(paths[1].includes('/attempts/1/jobs?'));
});

test('immutable manifest strips development and locks image/source/assets', () => {
  const result = candidate();
  assert.equal(result.manifest.schemaVersion, 'app.0.2');
  assert.equal(result.manifest.defaultRuntime, 'docker');
  assert.deepEqual(result.manifest.runtimeProfiles.map((profile: { key: string }) => profile.key), ['docker']);
  assert.deepEqual(Object.keys(result.manifest.services[0].runtimes), ['docker']);
  assert.deepEqual(result.manifest.services[0].runtimes.docker.image, { repository: config.imageRepository, digest: imageDigest });
  assert.equal(result.manifest.source.commit, source);
  assert.deepEqual(result.manifest.data.targets, [{ runtime: 'docker' }]);
  assert.equal(result.descriptor.manifestSha256, sha256(jsonBytes(result.manifest)));
  assert.equal(result.descriptor.files[0].sha256, sha256('<svg/>'));
  assert.equal(result.descriptor.releaseId, candidate({ build: { ...build, runId: 99 } }).descriptor.releaseId);
  assert.notEqual(result.descriptor.releaseId, candidate({ imageDigest: 'sha256:' + 'd'.repeat(64) }).descriptor.releaseId);
  assert.throws(() => candidate({ validation: { ...validation, sourceCommit: nextSource } }));
  assert.throws(() => candidate({ files: [{ path: '../outside', data: 'bad' }] }));
  assert.throws(() => candidate({ files: [{ path: 'release.json', data: '{}' }] }));
  const bad = structuredClone(manifest);
  Object.assign(bad.services[0].runtimes.docker, { setup: 'npm ci' });
  assert.throws(() => candidate({ manifest: bad }));
  assert.equal(manifest.schemaVersion, 'app.0.1');
});

class MemoryStore {
  snapshots = new Map<string, Map<string, string | Buffer>>();
  head: string | null = null;
  events: string[] = [];
  ancestor = (before: string, after: string) => before === source && after === nextSource;
  read(head: string | null, path: string) { return head ? this.snapshots.get(head)?.get(path) ?? null : null; }
  json(head: string | null, path: string) { const data = this.read(head, path); return data === null ? null : JSON.parse(data.toString()); }
  async update(message: string, changesForHead: (head: string | null) => Record<string, { value: unknown; immutable?: boolean }>) {
    const changes = await changesForHead(this.head);
    if (!Object.keys(changes).length) return this.head;
    const snapshot = new Map(this.head ? this.snapshots.get(this.head) : undefined);
    for (const [path, change] of Object.entries(changes)) {
      const data = typeof change.value === 'string' || Buffer.isBuffer(change.value) ? change.value : jsonBytes(change.value);
      if (change.immutable && snapshot.has(path) && sha256(snapshot.get(path)) !== sha256(data)) throw new Error('Immutable collision.');
      snapshot.set(path, data);
    }
    this.head = (this.snapshots.size + 1).toString(16).padStart(40, '0');
    this.snapshots.set(this.head, snapshot);
    this.events.push(message);
    return this.head;
  }
}
const imageOk = async (_repo: string, digest: string) => ({ digest, platforms: config.platforms });
function fileOk(store: MemoryStore, events: string[] = []) {
  return async (url: string, expected: string | Buffer) => {
    const prefix = `https://raw.githubusercontent.com/${config.repository}/`;
    assert(url.startsWith(prefix));
    const [head, ...parts] = url.slice(prefix.length).split('/');
    const actual = store.read(head, parts.join('/'));
    assert(actual !== null, 'Consumer fetch targets retained commit bytes.');
    assert.equal(sha256(actual), sha256(expected));
    events.push(parts.join('/'));
  };
}

test('publish verifies image and retained public bytes before advancing a feed; replay keeps original receipt', async () => {
  const store = new MemoryStore(), events: string[] = [], release = candidate();
  const result = await publishRelease({ config, release, store, verifyImage: async (...args: [string, string]) => {
    assert.equal(store.head, null); events.push('image'); return imageOk(...args);
  }, verifyFile: async (url: string, value: string | Buffer) => {
    if (!url.endsWith('/feeds.json')) assert.equal(store.json(store.head, 'feeds.json'), null);
    return fileOk(store, events)(url, value);
  } });
  assert.equal(result.outcome, 'advance');
  assert.equal(store.events.length, 2);
  assert.equal(events[0], 'image');
  assert(events.indexOf('releases/' + release.descriptor.releaseId + '/release.json') < events.indexOf('feeds.json'));
  const state = store.json(store.head, 'feed-state.json');
  assert(state.manifestRef.includes('/' + result.metadataCommit + '/releases/'));
  const original = store.read(store.head, 'releases/' + release.descriptor.releaseId + '/release.json');
  const replay = await publishRelease({ config, release: candidate({ build: { ...build, runId: 99 } }), store,
    verifyImage: imageOk, verifyFile: fileOk(store) });
  assert.equal(replay.outcome, 'same-release');
  assert.equal(store.events.length, 2);
  assert.equal(store.read(store.head, 'releases/' + release.descriptor.releaseId + '/release.json'), original);
});

test('image or public release failure cannot announce incomplete artifacts; retry recovers retained bytes', async () => {
  const store = new MemoryStore(), release = candidate();
  await assert.rejects(publishRelease({ config, release, store, verifyImage: async () => { throw new Error('private image'); } }));
  assert.equal(store.head, null);
  await assert.rejects(publishRelease({ config, release, store, verifyImage: imageOk,
    verifyFile: async () => { throw new Error('raw metadata not yet public'); } }));
  assert.equal(store.events.length, 1);
  assert.equal(store.json(store.head, 'feeds.json'), null);
  await publishRelease({ config, release, store, verifyImage: imageOk, verifyFile: fileOk(store) });
  assert.equal(store.events.length, 2);
});

test('stable never regresses, diverges, or changes for a different build of an already published source', async () => {
  const store = new MemoryStore();
  await publishRelease({ config, release: candidate(), store, verifyImage: imageOk, verifyFile: fileOk(store) });
  const same = await publishRelease({ config, release: candidate({ imageDigest: 'sha256:' + 'd'.repeat(64) }), store,
    verifyImage: imageOk, verifyFile: fileOk(store) });
  assert.equal(same.outcome, 'same-source');
  assert.equal(store.json(store.head, 'feed-state.json').sourceCommit, source);
  const next = candidate({ sourceCommit: nextSource, validation: { ...validation, sourceCommit: nextSource }, build: { ...build, sourceCommit: nextSource } });
  await publishRelease({ config, release: next, store, verifyImage: imageOk, verifyFile: fileOk(store) });
  const finalFeed = canonical(store.json(store.head, 'feeds.json'));
  await assert.rejects(publishRelease({ config, release: candidate(), store, verifyImage: imageOk, verifyFile: fileOk(store) }), /regress or diverge/);
  assert.equal(canonical(store.json(store.head, 'feeds.json')), finalFeed);
  assert.throws(() => promotion({ schemaVersion: 'trading-lab-feed-state.0.1', sourceCommit: nextSource, releaseId: 'd'.repeat(64) },
    candidate().descriptor, () => false), /regress or diverge/);
});

test('consumer availability retries transient misses and rejects altered bytes', async () => {
  let calls = 0, waits = 0;
  await consumerFile('https://example.invalid/release', 'correct', { request: async () => ++calls === 1
    ? new Response('', { status: 404 }) : new Response('correct'), wait: async () => { waits++; } });
  assert.equal(calls, 2);
  assert.equal(waits, 1);
  await assert.rejects(consumerFile('https://example.invalid/release', 'correct', { request: async () => new Response('changed'),
    attempts: 1 }), /differs/);
});

test('metadata transport uses normal fast-forward push and recovers an uncertain successful push', async () => {
  const calls: string[][] = [], commit = 'd'.repeat(40);
  let remote: string | null = null;
  const store = new MetadataStore('.', 'app-releases', { run: (args: string[], options: { input?: string } = {}) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return remote ? `${remote}\trefs/heads/app-releases` : '';
    if (args[0] === 'hash-object') { assert.equal(options.input, 'immutable\n'); return 'e'.repeat(40); }
    if (args[0] === 'write-tree') return 'f'.repeat(40);
    if (args[0] === 'commit-tree') return commit;
    if (args[0] === 'push') { remote = commit; throw new Error('response lost'); }
    return '';
  } });
  assert.equal(await store.update('retain', () => ({ 'release.json': { value: 'immutable\n', immutable: true } })), commit);
  assert(calls.some(args => args[0] === 'push' && args[2] === `${commit}:refs/heads/app-releases`));
  assert(!calls.flat().some(arg => arg.includes('force')));
});

test('release packaging includes linked license and preserves binary bytes; escaping symlinks are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'trading-release-assets-'));
  try {
    mkdirSync(join(root, 'docs')); mkdirSync(join(root, 'assets')); mkdirSync(join(root, 'LICENSES'));
    writeFileSync(join(root, 'docs/store.md'), '# Store\n\n[License](../LICENSES/terms.txt)\n');
    writeFileSync(join(root, 'LICENSES/terms.txt'), 'All rights reserved.');
    writeFileSync(join(root, 'assets/icon.png'), Buffer.from([0, 255, 128, 1]));
    const files = releaseFiles(root, { catalogMetadata: { icon: 'assets/icon.png', descriptionFile: 'docs/store.md' } });
    assert.deepEqual(files.map((file: { path: string }) => file.path), ['assets/icon.png', 'docs/store.md', 'LICENSES/terms.txt'].sort((a, b) => a.localeCompare(b, 'en')));
    assert.deepEqual(files.find((file: { path: string }) => file.path === 'assets/icon.png').data, Buffer.from([0, 255, 128, 1]));
    symlinkSync(tmpdir(), join(root, 'escape'));
    assert.throws(() => releaseFiles(root, { catalogMetadata: { icon: 'escape' } }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('metadata publication refreshes concurrent heads and preserves their tree before retrying', async () => {
  const original = '1'.repeat(40), concurrent = '2'.repeat(40), firstCommit = '3'.repeat(40), secondCommit = '4'.repeat(40);
  let remote = original, commits = 0, calls = 0;
  const parents: string[] = [], reads: string[] = [];
  const store = new MetadataStore('.', 'app-releases', { run: (args: string[]) => {
    if (args[0] === 'ls-remote') return `${remote}\trefs/heads/app-releases`;
    if (args[0] === 'ls-tree') return '';
    if (args[0] === 'hash-object') return '5'.repeat(40);
    if (args[0] === 'read-tree') reads.push(args[1]);
    if (args[0] === 'write-tree') return '6'.repeat(40);
    if (args[0] === 'commit-tree') { parents.push(args[3]); return ++commits === 1 ? firstCommit : secondCommit; }
    if (args[0] === 'merge-base') throw Object.assign(new Error('not an ancestor'), { status: 1 });
    if (args[0] === 'push') {
      if (remote === original) { remote = concurrent; throw new Error('non-fast-forward'); }
      remote = secondCommit;
    }
    return '';
  } });
  assert.equal(await store.update('retain', (head: string) => { calls++; assert.equal(head, calls === 1 ? original : concurrent);
    return { 'new.json': { value: 'retained', immutable: true } }; }), secondCommit);
  assert.deepEqual(parents, [original, concurrent]);
  assert.deepEqual(reads, [original, concurrent]);
});

test('metadata transport reads immutable assets without UTF-8 re-encoding', () => {
  const binary = Buffer.from([255, 128, 0]);
  const store = new MetadataStore('.', 'app-releases', { run: (args: string[], options: { encoding?: unknown; trim?: boolean } = {}) => {
    if (args[0] === 'ls-tree') return '100644 blob object\tasset.png';
    assert.equal(options.encoding, null);
    assert.equal(options.trim, false);
    return binary;
  } });
  assert.deepEqual(store.read('a'.repeat(40), 'asset.png'), binary);
});
