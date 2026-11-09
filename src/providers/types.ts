import type { Instrument, Interval, Observation } from "../model.js";
export interface HistoryRequest { from: string; to: string; interval: Interval }
export interface DataSet { observations: Observation[]; warnings: string[] }
export interface ProviderInfo {
  id: string; name: string; kind: "market" | "import" | "synthetic"; configured: boolean;
  live: boolean; history: boolean; search: boolean; intervals: Interval[];
  pollSeconds: number; description: string;
}
export interface MarketDataProvider {
  info: ProviderInfo;
  search(query: string, owner: string): Promise<Instrument[]>;
  resolve(id: string, owner: string): Promise<Instrument>;
  latest(instrument: Instrument): Promise<Observation | null>;
  history(instrument: Instrument, request: HistoryRequest, owner: string): Promise<DataSet>;
}
export class ProviderError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export function checkedRange(r: HistoryRequest) {
  const from = Date.parse(r.from), to = Date.parse(r.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * 86400000) throw new ProviderError("Select a valid date range of at most 366 days.");
  if (!["1min", "5min", "1day"].includes(r.interval)) throw new ProviderError("Unsupported interval.");
  return { from, to };
}
