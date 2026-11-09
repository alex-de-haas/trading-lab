import type { Currency, Instrument, Observation } from "../model.js";
import { intervalMs } from "../model.js";
import { money } from "../engine.js";
import { checkedRange, ProviderError, type HistoryRequest, type MarketDataProvider } from "./types.js";
const scenarios = [["WAVE", "Demo waves"], ["CHOP", "Demo choppy market"], ["DRIFT", "Demo slow trend"]];
export const demoInstruments: Instrument[] = (["USD", "EUR"] as Currency[]).flatMap(currency => scenarios.map(([symbol,name]) => ({
  id: `demo:SIM:${symbol}:${currency}`, provider: "demo", symbol, name, exchange: "SIM", currency
})));
function price(i: number, symbol: string) {
  const value = symbol === "CHOP" ? 100 + 0.85 * Math.sin(i * 2.3) + 0.7 * Math.sin(i * 0.4)
    : symbol === "DRIFT" ? 100 + 12 * Math.sin(i / 120) + 1.8 * Math.sin(i / 9)
    : 100 + 5 * Math.sin(i / 8) + 2 * Math.sin(i / 2.4) + 8 * Math.sin(i / 70);
  return money(value);
}
export function demoObservation(instrument: Instrument, timestamp: number, interval: HistoryRequest["interval"] = "1min", index = Math.floor(timestamp / 5000)): Observation {
  return { instrumentId: instrument.id, provider: "demo", price: price(index, instrument.symbol), timestamp: new Date(timestamp).toISOString(), receivedAt: new Date().toISOString(), interval, adjustment: "raw" };
}
export const demoProvider: MarketDataProvider = {
  info: { id: "demo", name: "Synthetic demo", kind: "synthetic", configured: true, live: true, history: true, search: true, intervals: ["1min","5min","1day"], pollSeconds: 5, description: "Generated prices, never actual stock quotes. Live demo advances every 5 seconds." },
  async search(query) { return demoInstruments.filter(i => (i.name+i.symbol+i.currency).toLowerCase().includes(query.toLowerCase())); },
  async resolve(id) { const i = demoInstruments.find(i => i.id === id); if (!i) throw new ProviderError("Demo instrument not found."); return i; },
  async latest(i) { return demoObservation(i, Math.floor(Date.now()/5000)*5000); },
  async history(i, r) {
    const {from,to} = checkedRange(r), step = intervalMs[r.interval];
    if ((to-from)/step > 5000) throw new ProviderError("Choose a shorter range or a larger interval (maximum 5,000 observations).");
    const observations = [];
    for (let t=from, index=0; t<=to; t+=step,index++) observations.push(demoObservation(i,t,r.interval,index));
    return {observations, warnings:["Synthetic prices for engine experiments. These are not historical market returns."]};
  }
};
