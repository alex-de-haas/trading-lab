# Trading Lab

A Hosty app for testing a deterministic trading strategy with virtual
money. It supports ongoing paper trading, historical replay and interchangeable
price providers. No brokerage account or real orders are involved.

## Try it

Production releases use the app-owned stable feed at
`https://raw.githubusercontent.com/alex-de-haas/trading-lab/app-releases/feeds.json`.
Its first external publication is pending. Install released versions through
Hosty's reviewed feed installation, then open the app and sign in with your Hosty
account. No market-data key is needed for synthetic and CSV experiments.

For source development, install this repository's `manifest.json` with its `dev`
Docker runtime in a registered workspace and a child Core with separate test data.
The authored `docker` image tag is a build template; the publisher advertises
generated manifests with exact image digests through the stable feed.

1. Choose **New experiment** and **Historical replay**.
2. Keep **Synthetic demo** to try the interface without a key, or choose **CSV import**
   for your own price history. Synthetic results are not actual stock returns.
3. Set the wallet, pool budget, entry/exit thresholds, commission and slippage.
4. Run the replay and compare total equity, fees, drawdown and buy-and-hold results.
5. For ongoing collection, create an **Ongoing paper trading** wallet, then allocate
   one or more pools. The backend keeps collecting while the app runs.

The strategy buys after a rise from the running low and sells after a fall from the
highest observed price while holding. Signals execute at the next observation, with
configured slippage. Every profitable closed cycle transfers its net profit to the
wallet. Losses shrink the pool; later profits do not automatically restore losses.
Top-ups while holding wait for the next purchase.

## Data providers

- **Synthetic demo:** generated USD/EUR instruments, available immediately.
- **CSV import:** timestamped history, available immediately. Files require
  `timestamp,close` columns, strictly increasing UTC timestamps, and positive prices.
  Specify currency, interval and adjustment basis in the import form. Maximum 5,000
  observations and 2 MB per file; replay ranges are limited to 366 days.
- **Twelve Data:** optional online adapter for USD-listed US stocks and ETFs. Configure
  `TWELVE_DATA_API_KEY` in the app's secret settings in Hosty and restart. Coverage,
  available history and delay depend on the provider account. The initial verification
  used contract fixtures; a real key has not been exercised.

```csv
timestamp,close
2026-10-01T20:00:00Z,100.00
2026-10-02T20:00:00Z,101.20
2026-10-05T20:00:00Z,102.40
```

The adapter boundary is [`MarketDataProvider`](src/providers/types.ts), registered in
[`src/providers/index.ts`](src/providers/index.ts). A new provider implements search,
instrument resolution, latest prices and history, and declares its capabilities.
The strategy does not depend on Twelve Data. See the [feature documentation](docs/features/paper-trading/feature.md)
for normalization, accounting, runtime behavior and limitations.

## Development

Use Node.js 24 and npm in the registered Hosty worktree:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run build
npm run release:check
npm run docs:check
```

`npm run build` writes a complete client/server package to `dist`; `npm start`
starts that package without source files or startup compilation. The dev profile
compiles the client at startup. The production image adopts the data mount's owner
and drops root privileges before starting Node. SQLite state lives in the
Hosty-managed app data volume. Exports contain experiments, normalized observations,
the ledger and performance metrics.

## Builds and publication

Pull requests and main run type checking, behavioral/publisher tests, compilation,
documentation and release-metadata checks, workflow linting and a Docker build.
PRs have no image or feed publication authority. A successful trusted main CI run
starts the release workflow for that exact source commit.

The publisher builds linux/amd64 and linux/arm64 images under unique candidate
tags, verifies anonymous pulls and source identity, retains immutable `app.0.2`
manifests and assets on `app-releases`, then advances the single stable feed in a
separate fast-forward commit. Failed or incomplete artifacts never advance it.
The app-specific pipeline conservatively rebuilds; it does not claim digest reuse
for unpinned operating-system package downloads. Retain published images and
metadata because installed versions refer to those exact bytes.

Before the first publication:

1. Ensure the approved public `alex-de-haas/trading-lab` repository exists and
   the publishing account can access it. Connect and publish source through
   Hosty's Publication workflow; the registered workspace can remain selected
   while connecting its remote. Use an authenticated publishing account with
   repository access, and keep normal merge commits.
2. Allow Actions to write repository contents and GHCR packages. After the first
   push creates the container package, set that package to **public** in GitHub's
   package settings. New packages start private, so the first anonymous verification
   can fail safely. Rerun that qualified release workflow after changing visibility;
   its retries preserve any already-retained metadata. See
   [GitHub's container registry guidance](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
3. Verify the published stable feed and its complete default release on a clean
   Hosty consumer. CI configuration alone is not publication evidence.
4. Submit [the prepared catalog entry](distribution/catalog-entry.json) as
   `apps/com.haas.trading-lab/entry.json` in the separately authorized
   `alex-de-haas/hosty-catalog` workspace, after the feed is available. The catalog
   vendors the icon and [store description](docs/store.md) from the release.

The application retains its existing reserved licensing status; see
[LicenseRef-Proprietary](LICENSES/LicenseRef-Proprietary.txt). Reused release-tooling
sources retain their own license and attribution under `scripts/releases`.

There are no guarantees of profit. Small repeated reversals, gaps and commissions
can produce sustained losses. This version omits dividends, taxes, FX conversion,
order-book liquidity and automatic corporate-action accounting.
