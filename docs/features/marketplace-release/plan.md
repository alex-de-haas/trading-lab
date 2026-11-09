---
status: In Progress
created: 2026-11-07
updated: 2026-11-09
summary: Package Trading Lab as an immutable Docker release, verify it through Hosty, and publish its build pipeline and Marketplace feed.
---

# Marketplace release

## Goal

Make Trading Lab installable from Hosty Marketplace without a source checkout or a
development runtime. Keep the existing paper-trading behavior and its independent
provider interface. The operator approved this plan and its proposed repository,
publisher, feed and catalog choices in chat on 2026-11-07.

## Baseline and target behavior

The [paper-trading feature](../paper-trading/feature.md) describes the implemented
application. The readiness baseline was the 0.1.0 bootstrap with pending
paper-trading changes; its only runtime was a Docker development profile with a
source mount. Type checking, all 37 existing tests, compilation and documentation checks
passed on macOS arm64 with Node 24.18.0 on 2026-11-07. The readiness review corrected
corporate-action resume and purchase-rounding defects, with 41 tests passing after
the corrections. These fixes belong to the existing paper-trading behavior.

The release adds a production image profile and makes it the installation default,
while retaining the development profile for registered workspaces. Production runs
without a source mount, dependency installation or a provider key. Synthetic and
CSV experiments work immediately; Twelve Data remains optional and its real-data
coverage remains unverified until a key is explicitly configured for testing.

Use the Hosty [release model](https://github.com/alex-de-haas/docker-host/blob/main/docs/features/repository-release-model/feature.md)
and [feed contract](https://github.com/alex-de-haas/docker-host/blob/main/skills/hosty-app-skill/references/app-feeds.md).
Do not publish moving image tags in release manifests or point Marketplace at the
development manifest. Authored manifests retain app.0.1; generated immutable
release manifests follow app.0.2 and lock production images by OCI digest.

## Deliverables

- [x] D1. Add a production Docker image and manifest profile with an explicit container port, health check, persistent data target and writable data-volume handling; retain the dev profile and verify clean image builds for linux/amd64 and linux/arm64.
- [x] D2. Add CI for pull requests and main with lockfile installation, type checking, behavioral tests, compilation, documentation and version/manifest checks; build the production image without publishing from pull requests.
- [x] D3. Add a release publisher gated on successful CI for the exact trusted main commit, with immutable multi-platform image and manifest metadata, consumer-availability checks, retained release receipts and replay-safe feed promotion.
- [ ] D4. Add app-owned feed metadata and a Marketplace card with publisher, description and icon; preserve the existing licensing status and prepare the catalog entry in its own authorized repository using the public feedsUrl.
- [x] D5. Install the production artifact in a managed child Core with separate data and normal password login; verify anonymous denial, Shell embedding, synthetic and CSV replay, collection, restart persistence and exports, then finish the child and confirm resource removal.
- [ ] D6. After explicit publication authorization, commit reviewed paths with configured authorship, publish to the selected repository, verify CI and release artifacts, and publish the catalog entry only after its default release is available.

## Execution and versioning

Keep these deliverables on one feature branch and one PR per repository. Source,
build pipeline and release metadata belong to the Trading Lab repository; the
Marketplace listing belongs to the catalog repository. Do not alter Core or the
Marketplace app implementation to add one application to a catalog.

The paper-trading feature and its release packaging share the 0.1.0 to 0.2.0
version outcome in manifest, package and lockfile. Retain this single version
outcome for the feature. A later independently shipped functionality change needs
its own version bump. Ordinary schemaVersion changes are not version bumps.

## Approved choices and prerequisites

- Use the approved source destination: a new public
  alex-de-haas/trading-lab repository, with images in the matching GHCR namespace.
  No repository creation, remote association, push, PR or merge is authorized by
  this document alone.
- Use Alex de Haas, the configured Git author, as the proposed publisher. This
  repository currently has no LICENSE file; adding an open-source license needs
  a separate owner decision and is outside the default release changes.
- Use a single stable feed for the first release, advanced after successful main
  CI and artifact availability checks. Additional feeds are outside this scope.
- Use the Hosty distribution catalog and obtain its own registered source
  workspace before editing it. Approval does not create that source binding.
- Core 0.178.1 accepts selected-file review IDs for local commits and inspects
  the remote while the registered workspace remains the selected Source folder.
  Remote association no longer requires a Return or a live runtime change.
- The current Publication tools connect an existing remote; hosted repository
  provisioning is not implemented by that feature. A new remote must first be
  created through an explicitly authorized provider workflow or by the operator.
  The operator created the approved public repository on 2026-11-09. Core
  connected it and initialized main from the accepted bootstrap commit.
- Set the first GHCR package to public after its initial push, then rerun the
  qualified release workflow. Anonymous verification intentionally blocks private
  packages before release retention or feed promotion.

## Verification

Run the repository checks after the last edit. Add regression coverage for the
production manifest, feed identity and release gating. Validate generated release
manifests with Core's actual parser, then verify installation through the managed
child rather than treating JSON shape or image health as proof of identity/UI.
Record platforms, commands, results and any unverified checks in the PR. Retain
the existing real-provider limitation without copying live credentials.

Local verification on 2026-11-07: macOS arm64, Node 24.18.0; all 61 tests,
typecheck, production compilation, release:check, docs:check and pinned actionlint
pass. Docker Buildx builds and loads linux/arm64 and linux/amd64 images. A generated
app.0.2 parser fixture is accepted by child Core 0.176.3 as a draft update; its
synthetic digest/CI evidence is only parser input, not a published release claim.
The production profile runs in that child with a verified local-image lock.
Hosted CI, registry publication and public-feed installation remain part of D6.

The managed-child browser check passed normal password login, application sign-in,
anonymous denial, standalone and Shell-embedded UI, synthetic replay (91 samples),
CSV replay (6 samples), background collection, pause/resume, a 25-unit pool top-up,
JSON export and persisted balances/ledger after app restart. At a 390-pixel Shell
viewport the embedded document is 388 pixels wide with no horizontal overflow.
The child used Core 0.176.3 and Shell 0.121.0. Native browser consumers exited,
Finish succeeded, fresh status reports no process/data root, and the child-owned
data directory is absent. Synthetic exports and screenshots remain outside Git.

## Publication status

D4 remains open because the catalog has no registered source workspace available
to this client. Its schema and contribution rules were read; the reviewed entry,
icon and store description are prepared in this repository, not submitted.

D6 is in progress. Core verified local implementation commit `a58bfc5` and a clean
worktree on 2026-11-09. The approved public repository is accessible, remote
association succeeded, and its main branch contains accepted bootstrap commit
`0059111`. The feature changes remain on the registered feature branch; publication
configuration requires `ci-required` on the exact merge commit. Hosted CI,
production image and feed availability, and catalog submission still require
their own observed results before this deliverable can be checked.

Core 0.178.1 resolves the earlier local-commit contract and Source-override
blockers: `commit_workspace` accepts `reviewId`, and remote operations work without
changing ordinary app execution. The release workflow has no numeric provider ID
until GitHub registers it. Publication completion does not substitute for the
release and feed verification required above; its policy can be amended explicitly
once that workflow is available. Merge remains a separate operator decision.

On completion, update feature documentation to the verified behavior, delete this
plan, regenerate docs/root.md, and keep publication and sandbox cleanup evidence
separate from source/workspace completion. Merge and workspace deletion require
their own authorization.
