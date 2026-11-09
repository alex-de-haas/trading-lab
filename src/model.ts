export type Currency = "USD" | "EUR";
export type Money = string;
export type Interval = "1min" | "5min" | "1day";
export interface Instrument {
  id: string; provider: string; symbol: string; name: string; exchange: string;
  mic?: string; currency: Currency; dataset?: string;
}
export interface Observation {
  instrumentId: string; provider: string; price: Money; timestamp: string;
  receivedAt: string; interval: Interval; adjustment: "raw" | "split-adjusted";
  corporateAction?: boolean;
}
export interface Strategy {
  entryPct: Money; exitPct: Money; fixedFee: Money; feePct: Money; slippagePct: Money;
}
export interface Position { quantity: Money; entryPrice: Money; cost: Money; capital: Money; high: Money; openedAt: string }
export interface Pool {
  id: string; instrument: Instrument; config: Strategy; cash: Money; pendingCash: Money;
  allocated: Money; swept: Money; realized: Money; fees: Money; position: Position | null;
  low: Money | null; last: Observation | null; pending: "buy" | "sell" | null;
  status: "running" | "paused"; notice: string; resumeAfter: string | null; unresolvedData: boolean;
  prices: Array<{ time: string; price: Money }>;
}
export interface LedgerEntry {
  id: number; time: string; type: "deposit" | "allocate" | "topup" | "buy" | "sell" | "profit" | "pause" | "resume" | "gap";
  poolId?: string; amount: Money; note: string; price?: Money; quantity?: Money; fee?: Money; pnl?: Money;
}
export interface Experiment {
  id: string; name: string; currency: Currency; provider: string; mode: "paper" | "replay";
  createdAt: string; balance: Money; deposits: Money; pools: Pool[]; ledger: LedgerEntry[];
  revision: number; equity: Array<{time: string; value: Money}>;
  replay?: { from: string; to: string; interval: Interval; samples: number; gaps: number; benchmark: Money; maxDrawdown: Money; adjustment: string; warnings: string[] };
}
export const defaults: Strategy = { entryPct: "1", exitPct: "1", fixedFee: "0", feePct: "0.1", slippagePct: "0.05" };
export const intervalMs: Record<Interval, number> = { "1min": 60000, "5min": 300000, "1day": 86400000 };
