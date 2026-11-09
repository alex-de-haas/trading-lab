import assert from 'node:assert/strict';
import { test } from 'node:test';
const { verifyImage } = await import(new URL('../scripts/releases/registry.mjs', import.meta.url).href);
const { sha256 } = await import(new URL('../scripts/releases/context.mjs', import.meta.url).href);
const source = 'a'.repeat(40), repository = 'ghcr.io/alex-de-haas/trading-lab';
function fixture({ missingArm = false, badLayer = false, wrongSource = false, privateImage = false } = {}) {
  const blobs = new Map<string, string>(), manifests = new Map<string, string>();
  function record(value: unknown, target: Map<string, string>) {
    const data = JSON.stringify(value), digest = 'sha256:' + sha256(data);
    target.set(digest, data);
    return { digest, size: Buffer.byteLength(data), mediaType: 'application/vnd.oci.image.manifest.v1+json' };
  }
  const entries = ['amd64', 'arm64'].map(architecture => {
    const config = record({ os: 'linux', architecture, config: { Labels: {
      'org.opencontainers.image.revision': wrongSource ? 'b'.repeat(40) : source,
      'org.opencontainers.image.source': 'https://github.com/alex-de-haas/trading-lab'
    } } }, blobs);
    const descriptor = record({ schemaVersion: 2, config, layers: [{ digest: 'sha256:' + 'd'.repeat(64), size: 5 }] }, manifests);
    return { ...descriptor, platform: { os: 'linux', architecture } };
  });
  const root = record({ schemaVersion: 2, manifests: missingArm ? entries.slice(0, 1) : entries }, manifests);
  const request = async (input: string, options: { method?: string } = {}) => {
    if (privateImage) return new Response('', { status: 403 });
    const url = new URL(input), match = url.pathname.match(/\/(manifests|blobs)\/(sha256:[a-f0-9]{64})$/);
    if (!match) throw new Error('Unexpected registry request.');
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-length': badLayer ? '4' : '5' } });
    const data = (match[1] === 'manifests' ? manifests : blobs).get(match[2]);
    return data === undefined ? new Response('', { status: 404 }) : new Response(data, { headers: {
      'content-length': String(Buffer.byteLength(data)), 'docker-content-digest': match[2]
    } });
  };
  return { root, request };
}

test('consumer OCI validation checks both platform manifests, config labels and layer availability', async () => {
  const { root, request } = fixture();
  const result = await verifyImage(repository, root.digest, ['linux/amd64', 'linux/arm64'], { request,
    sourceCommit: source, sourceRepository: 'https://github.com/alex-de-haas/trading-lab' });
  assert.equal(result.digest, root.digest);
  assert.deepEqual(result.platforms, ['linux/amd64', 'linux/arm64']);
});

for (const [name, options] of Object.entries({ 'missing platform': { missingArm: true }, 'unavailable layer': { badLayer: true },
  'wrong source commit': { wrongSource: true }, 'non-public image': { privateImage: true } })) {
  test(`consumer OCI validation refuses ${name}`, async () => {
    const { root, request } = fixture(options);
    await assert.rejects(verifyImage(repository, root.digest, ['linux/amd64', 'linux/arm64'], { request,
      sourceCommit: source, sourceRepository: 'https://github.com/alex-de-haas/trading-lab' }));
  });
}
