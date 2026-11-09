import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = (name: string) => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');

test('PR CI builds without registry login or publication authority', () => {
  const ci = workflow('ci');
  assert.match(ci, /pull_request:/);
  assert.match(ci, /contents: read/);
  assert.match(ci, /name: ci-required/);
  assert.match(ci, /push: false/);
  assert(!/packages: write|contents: write|login-action|pull_request_target|workflow_run:/.test(ci));
});

test('release workflow gates trusted exact main CI before publishing either images or metadata', () => {
  const release = workflow('release');
  assert.match(release, /workflow_run:/);
  assert(!/workflow_dispatch:|pull_request:|pull_request_target:/.test(release));
  assert.match(release, /workflow_run\.event == 'push'/);
  assert.match(release, /workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(release, /workflow_run\.head_branch == 'main'/);
  assert.match(release, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert(release.indexOf('scripts/releases/gate.mjs') < release.indexOf('push: true'));
  assert(release.indexOf('steps.image.outputs.digest') < release.indexOf('scripts/releases/publish.mjs'));
  assert.match(release, /platforms: linux\/amd64,linux\/arm64/);
  assert(!/--force|:latest/.test(release));
});
