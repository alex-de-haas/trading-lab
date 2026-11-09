---
created: 2026-11-04
updated: 2026-11-07
summary: Virtual trading with trailing reversal rules, isolated wallets and pools, replaceable price providers, live collection and historical replay.
---

# Paper trading

Trading Lab (`com.haas.trading-lab`, version 0.2.0) is a separate local Hosty application.
Its React page and Node.js backend support experiments with virtual money, using
normal Hosty identity. Each user's experiments and imported datasets are isolated.
The app makes no brokerage requests and places no real orders.

## Strategy and accounting

While flat, a pool tracks the running low. A rise by the entry threshold queues a
buy. While holding, it tracks the running high; a fall by the exit threshold queues
a sale, including a sale at a loss. Default thresholds are 1%. A queued order executes
at the next eligible observation with adverse slippage, rather than at the threshold
price. Replay uses ordered closes without inferring an intrabar path. The last open
position remains open and the final queued signal remains pending.

Each experiment owns a USD or EUR wallet. Pool allocation debits that wallet
atomically. Pools simulate fractional shares rounded down to eight decimal places;
money uses decimal arithmetic with eight decimal places and commissions round up.
Each buy and sell includes a fixed and percentage commission. Purchases reserve the
fixed exit commission and decline unaffordable quantities. Purchase sizing accounts
for rounded commissions and cost, including instruments priced below one currency
unit; strategy execution and the buy-and-hold comparison use the same sizing rule.

A profitable cycle transfers all positive net realized profit to the main wallet.
A 100-unit pool closing at 102 retains 100 and transfers 2. A loss to 98 reduces the
pool to 98; a later gain of 2 transfers 2 without restoring the earlier loss. Pools
never replenish themselves from the wallet. Top-ups debit the wallet immediately;
while holding, they remain separate pending cash, excluded from that cycle's profit,
until the next purchase. No pool can spend another pool's funds.

The page distinguishes realized profit, swept profit and total equity, including
open positions after estimated exit slippage and commission. It shows quantity,
entry cost, market value, estimated liquidation value and unrealized P&L. Net result
subtracts all external virtual deposits. The append-only ledger records allocations,
top-ups, executions, commissions, withdrawals, pauses and collection gaps.

## Data-provider boundary

[`src/providers/types.ts`](../../../src/providers/types.ts) defines `MarketDataProvider`.
Adapters declare capabilities and implement instrument search/resolution, latest
observations and historical observations. Registration is in
[`src/providers/index.ts`](../../../src/providers/index.ts); the engine has no vendor dependency.
Adding an adapter requires normalization and contract tests, without changing strategy
or wallet accounting.

Instrument identity includes provider, exchange and currency, rather than a bare
ticker. Observations carry provider identity, instrument ID, UTC source timestamp,
receipt timestamp, interval and adjustment basis. Wrong instruments/currencies,
duplicates, out-of-order data and inconsistent adjustment metadata are rejected.
Live observations older than 15 minutes or over one minute in the future are ignored.
Provider selection is fixed per experiment; a different source needs a new experiment.

| Provider | Behavior | Constraints |
| --- | --- | --- |
| Synthetic demo | Deterministic WAVE, CHOP and DRIFT instruments in USD/EUR; five-second live observations and generated history | Explicitly labeled synthetic, never actual stock prices |
| CSV import | User-owned history with strict UTC `timestamp,close` rows and optional `corporate_action` flags | Up to 5,000 rows, 2 MB, consistent declared interval/currency/adjustment basis; no resampling |
| Twelve Data | Server-side search and history for USD US stocks/ETFs; completed minute-bar observations for live collection | Optional secret key, account-dependent coverage and delay, no tested real key in the initial verification |

Twelve Data keys are confined to backend authorization headers. Requests use a fixed
provider origin, a ten-second timeout, shared in-flight requests, bounded caching and
quota backoff with sanitized errors. The persistent shared budget allows up to eight
requests per minute and 750 per UTC day. Live collection polls at most every five
minutes per instrument during weekday US market hours and the closing-data allowance.
Exchange holidays are not independently modeled; freshness checks reject stale data.
Open browser tabs do not create additional upstream polling.

The adapter uses raw live prices and split-adjusted history. Minute bars are timestamped
at their completion; daily closes are converted from exchange time with daylight-saving
handling. Available history and intervals remain subject to provider access. Oversized
or truncated history is reported explicitly. Provider denial does not fall back to
generated prices.

Live corporate-action flags, adjustment-basis changes and a price jump of at least
35% pause the pool before accepting the new mark. This heuristic can flag a genuine
market move and does not detect every corporate action. The app does not automatically
adjust shares or cash; an unresolved discontinuity needs a new experiment with a
consistent dataset. The unresolved-data flag persists independently of display
notices and blocks Resume and subsequent marks, including after a provider failure
or restart. Existing saved pools recover this flag from their notice or pause
ledger. An adjustment-basis change also pauses the pool and retains its trusted
mark. Ordinary pause/resume cancels queued orders and waits for a fresh observation.
Positions paused by the user continue to be marked but cannot trade.

## Replay and UI

Historical replays have separate wallets and immutable results. Date ranges are limited
to 366 days and supported intervals are one minute, five minutes and one day. Results
show fees, realized/unrealized P&L, net equity, maximum drawdown and buy-and-hold equity
with the same budget and transaction-cost assumptions. Idle wallet money is included
in both results. Gaps include market closures and do not necessarily mean missing
provider data. The comparison excludes dividends, taxes, FX and liquidity constraints.

The responsive page contains experiment selection, portfolio totals, pool controls,
price/equity charts, fill markers and an activity ledger. Charts retain up to 5,000
observations; the page shows the last 200 ledger entries and trade markers. JSON export
includes the full ledger and available normalized observation history. CSV imports
require explicit dataset metadata. Twelve Data is visibly unavailable without its key.
The page supports both standalone and Shell embedding without duplicate app chrome.

## Runtime and persistence

The default `docker` profile executes a production image with Node.js 24.18.0 and
precompiled client/server assets. It needs no source mount, dependency installation
or browser compilation at startup. The image adopts the data mount's owner and
drops privileges before starting Node. The `dev` Docker profile retains its
read-only source mount and separate dependency cache. Both profiles use the same
`/app/data` storage contract.

The service listens on container port 3000 by default and validates an explicit
`PORT`. Hosty's published external port is not its internal listen port. The
optional `TWELVE_DATA_API_KEY` secret requires a restart when changed. The
[release pipeline](../marketplace-release/feature.md) generates digest-locked
production manifests; the authored image tag is a build template.

SQLite persists user-scoped experiments, datasets and request budgets. Transactional
updates prevent duplicate spending and preserve the ledger prefix. There are limits
of 60 experiments and 40 datasets per user and 20 pools per experiment. The background
runner works while the app runs, independent of browser connections. Startup cancels
pending executions, records a downtime gap and resumes from fresh data; it creates no
fills for unseen prices. Existing positions and balances survive a restart.

Authenticated SSE supplies snapshots and updates, revalidates identity, handles slow
clients and removes disconnected listeners. The page resynchronizes after reconnect
or becoming visible and keeps form state separate from live portfolio state. Mutating
HTTP requests require JSON and matching origin. There is no production authentication
bypass. Core grants are checked for the intended app.

## Verification record

Verification on 2026-11-04 used macOS arm64 with Node.js 24.18.0, npm 11.16.0, Core
0.172.0 and an isolated Docker child with Shell 0.121.0. Type checking, all 37 unit and
HTTP integration tests, and production bundle compilation passed. Normal password
login, app identity, standalone UI, Shell embedding, a 390-pixel embedded viewport,
demo replay, CSV upload/replay, ongoing demo collection, pause/resume, wallet-to-pool
top-ups, JSON export and restart persistence were exercised through the browser.

The imported synthetic fixture produced 1,001.36 total equity from 1,000 initial
funds, including 2.63 swept profit and an open position with a loss. This verifies
accounting presentation, not expected market performance. A startup failure caused
by using the published port inside Docker was corrected and the restarted service
reported healthy. Live provider coverage, real request quotas and actual quote delay
remain unverified because no Twelve Data key was supplied. Adapter fixtures do not
constitute a real-data test.

A readiness review on 2026-11-07 corrected a corporate-action Resume bypass and
purchase rounding that could incorrectly refuse affordable orders or leave the
buy-and-hold benchmark in cash. All 41 unit and HTTP integration tests, type checking,
compilation and documentation checks pass on macOS arm64 with Node 24.18.0. New
regressions cover notice changes, legacy state recovery, disk reopen, tiny prices,
exit-fee reserves and benchmark parity. The subsequent production-image browser
and restart checks are recorded in the [release verification](../marketplace-release/feature.md#verification-record).

## Testing Expectations

Run `npm run typecheck`, `npm test`, `npm run build` and `npm run docs:check` from the
registered worktree. Keep the documentation validators identical to the canonical
Hosty scripts. Engine tests cover reversal boundaries, next-observation execution,
fees/slippage, losses, profit sweeps, pending top-ups, stale data, provenance,
corporate actions and reconciliation. Store/API tests cover atomic concurrent
allocations, ownership, authentication, immutable history, restart recovery and SSE.
Keep unresolved-data locks independent of notices and verify old saved state;
cover affordable low-price purchases and matching benchmark sizing after rounding.
Provider tests cover deterministic equivalence, strict CSV validation, completed-bar
timestamps, time zones, missing credentials, redaction, sharing and rate budgets.

Use a managed child Core with separate users/data for browser and runtime changes.
Verify normal login, embedded launch, responsive layout and restart persistence;
export useful results before finishing the child and verify resource removal. Test a
real provider only with an explicitly configured key; keep that result separate from
fixtures and generated data. Commit, local source acceptance and ordinary-host
activation require their own authorization.
