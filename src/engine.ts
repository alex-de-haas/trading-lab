import Decimal from "decimal.js";
import type { Experiment, Instrument, LedgerEntry, Observation, Pool, Strategy } from "./model.js";
Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_EVEN });
export const D = (v: Decimal.Value) => new Decimal(v);
export const money = (v: Decimal.Value) => D(v).toDecimalPlaces(8).toFixed();
const down = (v: Decimal.Value) => D(v).toDecimalPlaces(8, Decimal.ROUND_DOWN);
const up = (v: Decimal.Value) => D(v).toDecimalPlaces(8, Decimal.ROUND_UP);
export class InputError extends Error {}
export function decimal(value: unknown, name: string, min = 0, max = 1e9): string {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length > 50) throw new InputError(`Invalid ${name}.`);
  let n: Decimal;
  try { n = D(value); } catch { throw new InputError(`Invalid ${name}.`); }
  if (!n.isFinite() || n.lt(min) || n.gt(max)) throw new InputError(`${name} must be between ${min} and ${max}.`);
  return money(n);
}
export function strategy(input: any): Strategy {
  if (!input || typeof input !== "object") throw new InputError("Strategy settings are required.");
  return {
    entryPct: decimal(input.entryPct, "Entry threshold", 0.01, 100),
    exitPct: decimal(input.exitPct, "Exit threshold", 0.01, 99),
    fixedFee: decimal(input.fixedFee, "Fixed fee", 0, 10000),
    feePct: decimal(input.feePct, "Percentage fee", 0, 20),
    slippagePct: decimal(input.slippagePct, "Slippage", 0, 20)
  };
}
export function log(e: Experiment, row: Omit<LedgerEntry, "id">) {
  e.ledger.push({ id: e.ledger.length + 1, ...row });
}
export function deposit(e: Experiment, amount: unknown, time = new Date().toISOString()) {
  const n = decimal(amount, "Deposit", 0.01);
  e.balance = money(D(e.balance).plus(n)); e.deposits = money(D(e.deposits).plus(n));
  log(e, { time, type: "deposit", amount: n, note: "Virtual funds added to wallet." });
}
export function addPool(e: Experiment, instrument: Instrument, config: Strategy, amount: unknown, id: string, time = new Date().toISOString()): Pool {
  if (instrument.currency !== e.currency || instrument.provider !== e.provider) throw new InputError("Pool currency and provider must match this experiment.");
  if (e.pools.length >= 20) throw new InputError("An experiment supports up to 20 pools.");
  if (e.mode === "replay" && e.pools.length) throw new InputError("A replay has one pool so its benchmark is comparable.");
  const n = decimal(amount, "Pool budget", 0.01);
  if (D(n).gt(e.balance)) throw new InputError("Insufficient wallet funds.");
  const p: Pool = { id, instrument, config: strategy(config), cash: n, pendingCash: "0", allocated: n, swept: "0", realized: "0", fees: "0", position: null, low: null, last: null, pending: null, status: "running", notice: "", resumeAfter: null, unresolvedData: false, prices: [] };
  e.balance = money(D(e.balance).minus(n)); e.pools.push(p);
  log(e, { time, type: "allocate", poolId: id, amount: n, note: "Wallet funds allocated to pool." });
  return p;
}
export function topup(e: Experiment, p: Pool, value: unknown, time = new Date().toISOString()) {
  const n = decimal(value, "Top-up", 0.01);
  if (D(n).gt(e.balance)) throw new InputError("Insufficient wallet funds.");
  e.balance = money(D(e.balance).minus(n));
  p.allocated = money(D(p.allocated).plus(n));
  if (p.position) p.pendingCash = money(D(p.pendingCash).plus(n));
  else p.cash = money(D(p.cash).plus(n));
  log(e, { time, type: "topup", poolId: p.id, amount: n, note: p.position ? "Reserved for the next purchase." : "Added to available pool cash." });
}
export function pause(e: Experiment, p: Pool, reason = "Paused by user.", time = new Date().toISOString()) {
  if (p.status === "paused" && p.notice === reason) return;
  p.status = "paused"; p.pending = null; p.notice = reason;
  log(e, { time, type: "pause", poolId: p.id, amount: "0", note: reason });
}
export function resume(e: Experiment, p: Pool, time = new Date().toISOString()) {
  if (p.unresolvedData) throw new InputError("This pool has unresolved market data. Export its result and start a new experiment with consistent prices.");
  p.status = "running"; p.pending = null; p.notice = ""; p.resumeAfter = time;
  p.low = null;
  if (p.position && p.last) p.position.high = p.last.price;
  log(e, { time, type: "resume", poolId: p.id, amount: "0", note: "Resume on the next fresh observation." });
}
export function fee(notional: Decimal.Value, config: Strategy) {
  return up(D(config.fixedFee).plus(D(notional).mul(config.feePct).div(100)));
}
function affordablePurchase(capital: Decimal.Value, fill: Decimal.Value, config: Strategy) {
  const quote = (quantity: Decimal) => {
    const notional = quantity.mul(fill), commission = fee(notional, config);
    return { quantity, commission, cost: up(notional.plus(commission)) };
  };
  const limit = down(Decimal.max(0, D(capital).minus(D(config.fixedFee).mul(2))).div(D(fill).mul(D(1).plus(D(config.feePct).div(100)))));
  const order = quote(limit);
  if (order.cost.plus(config.fixedFee).lte(capital)) return order;
  // Rounded fees can require removing many share units for a very small price.
  // Search integer units rather than decrementing quantities one unit at a time.
  let low = 0n, high = BigInt(limit.mul(100000000).toFixed(0));
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const candidate = quote(D(middle.toString()).div(100000000));
    if (candidate.cost.plus(config.fixedFee).lte(capital)) low = middle;
    else high = middle - 1n;
  }
  return quote(D(low.toString()).div(100000000));
}
export function liquidation(p: Pool): Decimal {
  if (!p.position || !p.last) return D(0);
  const value = D(p.position.quantity).mul(p.last.price).mul(D(1).minus(D(p.config.slippagePct).div(100)));
  return value.minus(fee(value, p.config));
}
export function equity(e: Experiment): string {
  return money(e.pools.reduce((total, p) => total.plus(p.cash).plus(p.pendingCash).plus(liquidation(p)), D(e.balance)));
}
export function markEquity(e: Experiment, time: string) {
  const row = { time, value: equity(e) };
  if (e.equity.at(-1)?.time === time) e.equity[e.equity.length - 1] = row; else e.equity.push(row);
  if (e.mode === "paper" && e.equity.length > 5000) e.equity.shift();
}
export function processObservation(e: Experiment, p: Pool, obs: Observation, now?: number): boolean {
  if (obs.provider !== e.provider || obs.instrumentId !== p.instrument.id) throw new InputError("Observation provenance does not match the pool.");
  const timestamp = Date.parse(obs.timestamp);
  if (!Number.isFinite(timestamp) || !Number.isFinite(Date.parse(obs.receivedAt))) throw new InputError("Invalid observation timestamp.");
  decimal(obs.price, "Price", 0.00000001);
  if (now !== undefined && (timestamp > now + 60000 || now - timestamp > 15 * 60000)) return false;
  if (p.last && timestamp <= Date.parse(p.last.timestamp)) return false;
  if (p.unresolvedData) return false;
  if (p.last && obs.adjustment !== p.last.adjustment) {
    p.unresolvedData = true;
    pause(e, p, "Price adjustment basis changed. Start a new experiment with consistent prices.", obs.timestamp); return false;
  }
  if (p.last && e.mode === "paper" && (obs.corporateAction || D(obs.price).div(p.last.price).minus(1).abs().gte("0.35"))) {
    p.unresolvedData = true;
    pause(e, p, "Price discontinuity detected. Start a new experiment with consistent prices; quantities are not adjusted automatically.", obs.timestamp);
    // Keep the last trusted mark until a person reviews the discontinuity.
    return false;
  }
  if (obs.corporateAction) {
    p.unresolvedData = true;
    pause(e, p, "Corporate action flagged in the dataset. Use consistently adjusted prices.", obs.timestamp); return false;
  }
  p.last = obs;
  p.prices.push({ time: obs.timestamp, price: obs.price });
  if (p.prices.length > 5000) p.prices.shift();
  if (p.status === "paused" || (p.resumeAfter && timestamp <= Date.parse(p.resumeAfter))) return true;
  p.resumeAfter = null;
  const price = D(obs.price);
  if (p.pending === "buy" && !p.position) {
    p.pending = null;
    const fill = price.mul(D(1).plus(D(p.config.slippagePct).div(100)));
    const capital = D(p.cash);
    const { quantity, commission, cost } = affordablePurchase(capital, fill, p.config);
    if (quantity.lte(0)) {
      pause(e, p, "Budget is too small to cover both commissions.", obs.timestamp); return true;
    }
    p.cash = money(capital.minus(cost));
    p.position = { quantity: quantity.toFixed(), entryPrice: money(fill), cost: cost.toFixed(), capital: capital.toFixed(), high: obs.price, openedAt: obs.timestamp };
    p.low = null; p.fees = money(D(p.fees).plus(commission)); p.notice = "";
    log(e, { time: obs.timestamp, type: "buy", poolId: p.id, amount: cost.toFixed(), price: money(fill), quantity: quantity.toFixed(), fee: commission.toFixed(), note: "Filled at the next observation with buy slippage." });
    return true;
  }
  if (p.pending === "sell" && p.position) {
    p.pending = null;
    const pos = p.position;
    const fill = price.mul(D(1).minus(D(p.config.slippagePct).div(100)));
    const proceeds = down(D(pos.quantity).mul(fill));
    const commission = fee(proceeds, p.config);
    const returned = D(p.cash).plus(proceeds).minus(commission);
    if (returned.lt(0)) throw new Error("Exit reserve invariant failed.");
    const pnl = returned.minus(pos.capital);
    p.cash = money(returned);
    p.realized = money(D(p.realized).plus(pnl)); p.fees = money(D(p.fees).plus(commission));
    log(e, { time: obs.timestamp, type: "sell", poolId: p.id, amount: money(proceeds.minus(commission)), price: money(fill), quantity: pos.quantity, fee: commission.toFixed(), pnl: money(pnl), note: "Filled at the next observation with sell slippage." });
    if (pnl.gt(0)) {
      p.cash = money(D(p.cash).minus(pnl)); p.swept = money(D(p.swept).plus(pnl)); e.balance = money(D(e.balance).plus(pnl));
      log(e, { time: obs.timestamp, type: "profit", poolId: p.id, amount: money(pnl), note: "Net cycle profit transferred to wallet." });
    }
    p.cash = money(D(p.cash).plus(p.pendingCash)); p.pendingCash = "0"; p.position = null; p.low = obs.price;
    return true;
  }
  if (p.position) {
    p.position.high = money(Decimal.max(p.position.high, price));
    if (price.lte(D(p.position.high).mul(D(1).minus(D(p.config.exitPct).div(100))))) p.pending = "sell";
  } else {
    p.low = money(p.low === null ? price : Decimal.min(p.low, price));
    if (price.gte(D(p.low).mul(D(1).plus(D(p.config.entryPct).div(100))))) p.pending = "buy";
  }
  return true;
}
export function maxDrawdown(points: Experiment["equity"]): string {
  let peak = D(0), max = D(0);
  for (const {value} of points) {
    peak = Decimal.max(peak, value);
    if (peak.gt(0)) max = Decimal.max(max, peak.minus(value).div(peak).mul(100));
  }
  return money(max);
}
export function buyAndHold(capital: string, first: string, last: string, config: Strategy): string {
  const entry = D(first).mul(D(1).plus(D(config.slippagePct).div(100)));
  const { quantity, cost } = affordablePurchase(capital, entry, config);
  if (quantity.lte(0)) return capital;
  const value = quantity.mul(last).mul(D(1).minus(D(config.slippagePct).div(100)));
  return money(D(capital).minus(cost).plus(value.minus(fee(value, config))));
}
