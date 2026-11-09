import { canonical, digest, fullCommit, jsonBytes, relativePath, sha256 } from './context.mjs';

export function validateConfig(config) {
  if (config?.schemaVersion !== 'trading-lab-publisher.0.1' || config.repository !== 'alex-de-haas/trading-lab'
    || config.appId !== 'com.haas.trading-lab' || config.imageRepository !== 'ghcr.io/alex-de-haas/trading-lab'
    || config.metadataBranch !== 'app-releases' || config.sourceBranch !== 'main' || config.feedId !== 'stable'
    || canonical(config.platforms) !== canonical(['linux/amd64', 'linux/arm64'])
    || config.ciWorkflow !== '.github/workflows/ci.yml' || config.ciJob !== 'ci-required') throw new Error('Invalid Trading Lab release configuration.');
  return config;
}

export function releaseCandidate({ config, manifest, sourceCommit, imageDigest, validation, build, files = [] }) {
  validateConfig(config);
  if (!fullCommit(sourceCommit) || !digest(imageDigest) || manifest.id !== config.appId
    || !/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) throw new Error('Invalid release source, image or app identity.');
  if (validation?.sourceCommit !== sourceCommit || validation.repository !== config.repository
    || validation.workflow !== config.ciWorkflow || validation.jobName !== config.ciJob
    || !Number.isSafeInteger(validation.runId) || !Number.isSafeInteger(validation.runAttempt)) throw new Error('Release source lacks exact CI evidence.');
  if (build?.sourceCommit !== sourceCommit || build.workflow !== '.github/workflows/release.yml'
    || !Number.isSafeInteger(build.runId) || build.runId <= 0 || !Number.isSafeInteger(build.runAttempt) || build.runAttempt <= 0) throw new Error('Release source lacks exact build evidence.');
  const emitted = structuredClone(manifest);
  const profile = emitted.runtimeProfiles?.find(item => item.key === 'docker' && item.type === 'docker' && !item.development);
  if (!profile || emitted.runtimeProfiles.some(item => !item.development && item.key !== 'docker') || emitted.services?.length !== 1 || emitted.services[0].key !== 'web') throw new Error('Expected one production Docker web service.');
  emitted.schemaVersion = 'app.0.2';
  emitted.runtimeProfiles = [{ ...profile, default: true }];
  emitted.defaultRuntime = 'docker';
  emitted.source = { type: 'git', repository: `https://github.com/${config.repository}.git`, branch: config.sourceBranch, commit: sourceCommit, manifestPath: 'manifest.json' };
  const runtime = emitted.services[0].runtimes?.docker;
  if (runtime?.type !== 'docker' || runtime.sourceMount || runtime.build || runtime.setup || runtime.artifact === 'source') throw new Error('Production image cannot execute a source recipe.');
  runtime.image = { repository: config.imageRepository, digest: imageDigest };
  runtime.artifact = 'image';
  emitted.services[0].runtimes = { docker: runtime };
  if (emitted.data?.targets) emitted.data.targets = emitted.data.targets.filter(target => target.runtime === 'docker');
  if (emitted.cache?.targets) emitted.cache.targets = emitted.cache.targets.filter(target => target.runtime === 'docker');
  const assets = files.map(file => {
    relativePath(file.path);
    const data = Buffer.from(file.data);
    if (file.path === 'manifest.json' || file.path === 'release.json' || data.length > 16 * 1024 * 1024) throw new Error('Invalid release asset.');
    return { path: file.path, sha256: sha256(data), size: data.length, data };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (new Set(assets.map(file => file.path)).size !== assets.length || assets.reduce((total, file) => total + file.size, 0) > 32 * 1024 * 1024) throw new Error('Invalid release asset set.');
  const fileRecords = assets.map(({ data: _data, ...record }) => record);
  const releaseId = sha256(canonical({ manifest: emitted, files: fileRecords }));
  const descriptor = { schemaVersion: 'app-release.0.1', appId: config.appId, releaseId,
    version: emitted.version, sourceCommit, manifestSha256: sha256(jsonBytes(emitted)), profiles: ['docker'], files: fileRecords,
    artifacts: [{ type: 'image', service: 'web', profile: 'docker', repository: config.imageRepository, digest: imageDigest,
      platforms: config.platforms, buildSourceCommit: sourceCommit }], validation, build };
  return { manifest: emitted, descriptor, files: assets };
}

export function promotion(current, release, isAncestor) {
  if (!current) return 'advance';
  if (current.schemaVersion !== 'trading-lab-feed-state.0.1' || !fullCommit(current.sourceCommit)
    || !/^[a-f0-9]{64}$/.test(current.releaseId ?? '')) throw new Error('Invalid retained feed state.');
  if (current.releaseId === release.releaseId) return 'same-release';
  if (current.sourceCommit === release.sourceCommit) return 'same-source';
  if (!isAncestor(current.sourceCommit, release.sourceCommit)) throw new Error('Stable promotion would regress or diverge from its source history.');
  return 'advance';
}
