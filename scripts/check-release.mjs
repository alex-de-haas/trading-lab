import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { releaseFiles } from './releases/assets.mjs';
import { validateConfig } from './releases/model.mjs';

export function checkRelease(root = process.cwd()) {
  const json = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const config = validateConfig(json('distribution/release-publisher.json'));
  const manifest = json('manifest.json'), pkg = json('package.json'), lock = json('package-lock.json');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.schemaVersion, 'app.0.1', 'Authored manifest keeps the compatible schema.');
  assert.equal(manifest.id, config.appId);
  for (const version of [pkg.version, lock.version, lock.packages[''].version]) assert.equal(version, manifest.version, 'App versions must match.');
  assert.equal(manifest.defaultRuntime, 'docker');
  assert(manifest.runtimeProfiles.some(profile => profile.key === 'docker' && !profile.development && profile.default));
  assert(manifest.runtimeProfiles.some(profile => profile.key === 'dev' && profile.development));
  const runtime = manifest.services.find(service => service.key === 'web')?.runtimes?.docker;
  assert.equal(runtime?.type, 'docker');
  assert.equal(runtime.image.repository, config.imageRepository);
  assert.equal(runtime.image.tag, manifest.version, 'The authored production reference uses the app version.');
  assert(!runtime.sourceMount && !runtime.setup && !runtime.build && runtime.artifact !== 'source');
  assert(manifest.data?.targets?.some(target => target.runtime === 'docker' && target.service === 'web' && target.environment === 'HOSTY_APP_DATA_DIR'));
  releaseFiles(root, manifest);
  if (existsSync(resolve(root, 'distribution/catalog-entry.json'))) {
    const entry = json('distribution/catalog-entry.json');
    assert.equal(entry.id, config.appId);
    assert.equal(entry.feedsUrl, `https://raw.githubusercontent.com/${config.repository}/${config.metadataBranch}/feeds.json`);
    assert(!entry.feeds, 'Catalogs point to app-owned feed metadata.');
  }
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const workflow = readFileSync(resolve(root, path), 'utf8');
    for (const match of workflow.matchAll(/\buses:\s*([^\s]+)@([^\s#]+)/g)) {
      assert(match[1].startsWith('docker://') ? /^sha256:[a-f0-9]{64}$/.test(match[2]) : /^[a-f0-9]{40}$/.test(match[2]), `Workflow action must be pinned: ${match[1]}`);
    }
  }
  return manifest.version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Release metadata and versions are consistent (${checkRelease()}).`);
}
