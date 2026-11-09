# Trading Lab

Test a trailing reversal strategy with virtual money, inspect every fill and fee,
and compare historical results with buy and hold.

Create separate USD or EUR wallets and allocate independent pools. A pool buys
after a rise from its running low and sells after a fall from its running high.
Signals fill at the next price observation, with configurable commissions and
slippage. Profitable cycles transfer their net gain to the wallet; losses reduce
the pool's remaining budget.

- Start immediately with clearly labeled synthetic instruments.
- Import your own timestamped CSV history for repeatable historical replays.
- Run ongoing paper experiments while the app collects prices in the background.
- Review price and equity charts, drawdown, fees, the activity ledger and exports.
- Keep each Hosty user's experiments and imported datasets separate.

Twelve Data is an optional adapter for USD-listed US stocks and ETFs. Configure
its key in Hosty's secret app settings and restart to enable it. Provider access,
history and delay depend on the account. Real-provider coverage is not verified
by the synthetic examples or adapter fixtures.

Trading Lab places no real orders and requires no brokerage account. Synthetic
performance is not a stock return or a prediction. Dividends, taxes, FX,
order-book liquidity and automatic corporate-action adjustments are excluded.

Install the production Docker runtime through Hosty's normal review flow and
sign in with your Hosty account. State lives in the app's managed data directory
and survives restarts. No provider key is needed for synthetic or CSV experiments.

Publisher: Alex de Haas. The source has no open-source license grant; its
existing all-rights-reserved status is described by LicenseRef-Proprietary.
