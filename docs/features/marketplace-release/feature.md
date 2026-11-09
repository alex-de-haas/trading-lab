---
created: 2026-11-07
updated: 2026-11-09
summary: Production Docker packaging, exact-source CI and an immutable stable-feed publisher for Trading Lab, with prepared Marketplace assets.
---

# Marketplace release

Trading Lab 0.2.0 has production Docker packaging and a repository-owned GitHub
Actions release pipeline configured for `alex-de-haas/trading-lab`. External image,
feed and catalog publication are not verified. The remaining delivery work
is tracked in the [release plan](plan.md).

## Runtime package

`npm run build` writes `dist/server.mjs`, `client.js`, `index.html`, `style.css` and
the authored manifest. `npm start` runs the package. Production reads the compiled
browser assets and does not need TypeScript source or esbuild at startup. The
development source recipe compiles its browser client at startup.

The multi-stage Dockerfile pins the Node.js 24.18.0 multi-platform base digest,
installs the lockfile, compiles without network access, prunes development
dependencies and copies the resulting package into the runtime stage. The final
image's root entrypoint adopts the existing data-mount UID/GID and uses gosu to
drop privileges. A root-owned fresh directory is assigned to the image's node
user. Root-owned app SQLite files from previous development runs are repaired
without changing the data directory's owner or unrelated content.

The authored app.0.1 manifest defaults to `docker`, retains the explicit `dev`
source recipe, publishes container port 3000 and uses `/app/data` for both
profiles. Its version tag names a source build template, not an advertised public
release. The service uses `PORT` for its container listener and ignores the
host-published `HOSTY_PORT_HTTP` when choosing that listener.

## Checks and publication

The CI workflow runs on pull requests and main pushes. Its `ci-required` job checks
the locked dependency graph, app versions and production metadata, TypeScript,
behavioral and publisher tests, production compilation, docs and pinned actionlint,
then builds an image without pushing. Its token has read-only contents permission.
Actions and the workflow linter are pinned by commit or image digest.

The release workflow starts after successful main CI. It checks the triggering
event's repository, branch, source commit, run attempt and workflow path against
GitHub's API, and requires successful completion of every CI job. It checks out
that exact source and builds linux/amd64 and linux/arm64 images under unique
candidate tags. PR and fork events do not have publication authority.

The app-specific publisher verifies the image graph anonymously, including both
platforms, readable layers and source labels. Generated app.0.2 manifests contain
one production runtime, an exact OCI digest and a full source commit. Referenced
icons, descriptions and local Markdown assets are packaged with their byte hashes.
The app-specific recipe conservatively rebuilds and does not claim reusable build
identity for operating-system packages fetched from mutable package indexes.

Release metadata is retained under `releases/<release-id>/` on `app-releases` with
source, CI and build receipts. The publisher checks exact public commit URLs before
a separate fast-forward commit updates `feeds.json`, `feed-state.json`,
`install.json` and a promotion receipt. The single `stable` feed is the default.
Missing images, non-public packages, altered bytes and failed checks stop feed
advancement. Retries recover retained releases and uncertain successful pushes;
concurrent updates refresh their base. Existing immutable paths cannot be changed.
Stable cannot regress or diverge from source history, and a new build of an already
published source preserves the first successful release for that source.

Initial GHCR package visibility is an operator prerequisite: a private package
fails anonymous verification. The [README](../../../README.md#builds-and-publication)
records the public-package setup and qualified workflow retry procedure.

## Marketplace assets

The manifest declares publisher Alex de Haas, a Utilities category, app tags, an
SVG icon, the store description and the existing reserved app licensing status.
The prepared catalog entry is
[`distribution/catalog-entry.json`](../../../distribution/catalog-entry.json).
It points only to the app-owned `app-releases/feeds.json`; it does not embed feeds
or imply catalog membership. Catalog edits require their own authorized source
workspace. The catalog vendors release-relative assets after a default release
is available.

## Verification record

On 2026-11-07, macOS arm64 and Node 24.18.0 passed all 61 tests, typecheck,
production compilation, release metadata checks, documentation validation and
pinned actionlint. Docker Buildx builds and loads both target platforms. A package
test starts the compiled service with no TypeScript source, verifies assets and
anonymous denial, and reopens its SQLite data after a restart.

A generated app.0.2 parser fixture is accepted as a draft update by child Core
0.176.3. Its synthetic image digest and CI evidence are fixture data, not proof of
a published release. The actual sandbox installation runs the production profile
from the locally built arm64 image, locked by Core as a local image. This verifies
production execution separately from public registry and feed availability.

The child browser check uses normal password login and installation-bound Core
navigation. Standalone and Shell-embedded app identity, anonymous denial,
synthetic replay (91 samples), CSV replay (6 samples), background collection,
pause/resume, pool top-ups, JSON export and restart persistence pass. A 390-pixel
Shell viewport contains a 388-pixel app document with no horizontal overflow and
no duplicate app header. Test consumers exited; Finish succeeded, subsequent
status reports no process or data root, and the child-owned directory is removed.
Synthetic evidence exports and screenshots stay outside the source repository.

## Testing Expectations

Run `npm run typecheck`, `npm test`, `npm run build`, `npm run release:check` and
`npm run docs:check` after changes. Lint both workflows with the pinned actionlint
image. Build both Linux platforms after changing runtime packaging. Keep version,
manifest and lockfile agreement, source-free package startup, port handling and
data ownership covered.

Publisher tests cover exact CI run/attempt qualification, missing platforms and
layers, source mismatch, non-public images, binary assets, path containment,
immutable metadata, artifact-before-feed ordering, retries, uncertain push
recovery and concurrent writes. Validate generated manifests with Core's actual
parser in a managed child. Use normal password login and Core/Shell preview
navigation to verify app identity, synthetic/CSV replay, collection, export and
restart persistence. Finish an owned test child after exporting useful results
and confirm resource removal. Hosted CI and published-feed acceptance remain
explicitly unverified until their external operations succeed.
