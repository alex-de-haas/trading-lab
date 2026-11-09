import { parse } from "csv-parse/sync";
import { decimal } from "../engine.js";
import type { Instrument, Interval, Observation } from "../model.js";
import { checkedRange, ProviderError, type DataSet, type MarketDataProvider } from "./types.js";
export interface ImportedData { id: string; owner: string; name: string; instrument: Instrument; interval: Interval; observations: Observation[]; warnings: string[] }
export function parseCsv(text: string, instrument: Instrument, interval: Interval, adjustment: Observation["adjustment"]): DataSet {
  if (Buffer.byteLength(text) > 2_000_000) throw new ProviderError("CSV must be smaller than 2 MB.");
  let rows: any[];
  try { rows = parse(text, { columns: true, bom: true, skip_empty_lines: true, trim: true, max_record_size: 4096 }); }
  catch { throw new ProviderError("Invalid CSV. Use the supplied timestamp,close template."); }
  if (rows.length < 2 || rows.length > 5000) throw new ProviderError("CSV must contain 2 to 5,000 observations.");
  let previous = -Infinity;
  const observations: Observation[] = rows.map((r,index) => {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(r.timestamp ?? "")) throw new ProviderError(`Row ${index+2}: timestamp must be an ISO UTC time ending in Z.`);
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0,19) !== r.timestamp.slice(0,19) || t <= previous) throw new ProviderError(`Row ${index+2}: timestamps must be unique and increasing.`);
    previous = t;
    if (r.corporate_action && !["true","false"].includes(r.corporate_action)) throw new ProviderError("corporate_action must be true or false.");
    return { instrumentId: instrument.id, provider: "csv", price: decimal(r.close,"CSV close",0.00000001), timestamp: new Date(t).toISOString(), receivedAt: new Date().toISOString(), interval, adjustment, corporateAction: r.corporate_action === "true" };
  });
  return { observations, warnings: [adjustment === "raw" ? "Raw imported prices. Check splits and corporate actions; dividends are excluded." : "Split-adjusted prices as declared by the importer; adjustment is not independently verified. Dividends are excluded."] };
}
export function csvProvider(list: (owner:string) => ImportedData[], get: (owner:string,id:string) => ImportedData | undefined): MarketDataProvider {
  return {
    info: { id:"csv", name:"CSV import", kind:"import", configured:true, live:false, history:true, search:true, intervals:["1min","5min","1day"], pollSeconds:0, description:"Replay your own timestamped data. Import files with timestamp,close columns." },
    async search(q,owner) { return list(owner).filter(d=>(d.name+d.instrument.symbol).toLowerCase().includes(q.toLowerCase())).map(d=>d.instrument); },
    async resolve(id,owner) { const data=get(owner,id); if(!data) throw new ProviderError("Imported dataset not found."); return data.instrument; },
    async latest() { throw new ProviderError("CSV imports support historical replay only."); },
    async history(i,r,owner) {
      const {from,to}=checkedRange(r), data=get(owner,i.id);
      if(!data) throw new ProviderError("Imported dataset not found.");
      if(r.interval!==data.interval) throw new ProviderError(`This dataset has interval ${data.interval}. Resampling is not implicit.`);
      const observations=data.observations.filter(o=>Date.parse(o.timestamp)>=from && Date.parse(o.timestamp)<=to);
      return { observations, warnings:data.warnings };
    }
  };
}
