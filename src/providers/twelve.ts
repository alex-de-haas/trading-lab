import type { Instrument, Observation } from "../model.js";
import { intervalMs } from "../model.js";
import { decimal } from "../engine.js";
import { checkedRange, ProviderError, type HistoryRequest, type MarketDataProvider } from "./types.js";
export type Transport = typeof fetch;
function instrument(row: any): Instrument {
  if (!row || row.currency !== "USD" || !["NASDAQ","NYSE","NYSE ARCA","CBOE","AMEX"].includes(String(row.exchange).toUpperCase()) || !/^[A-Z0-9.^-]{1,24}$/.test(row.symbol ?? "")) throw new ProviderError("This first market adapter supports USD stocks on recognized US exchanges.");
  const exchange=String(row.exchange), symbol=String(row.symbol);
  return { id:`twelve:${exchange}:${symbol}:USD`, provider:"twelve", symbol, name:String(row.instrument_name ?? row.name ?? symbol).slice(0,160), exchange, mic:row.mic_code || undefined, currency:"USD" };
}
function verifyMeta(meta:any,i:Instrument) {
  const actual=instrument(meta);
  if(actual.id!==i.id || (i.mic && actual.mic && i.mic!==actual.mic)) throw new ProviderError("The provider returned a different instrument or currency.");
}
function dailyCloseUtc(date:string, zone:string): number {
  if(!/^\d{4}-\d\d-\d\d$/.test(date)) throw new ProviderError("Invalid daily date.");
  // Daily API bars are exchange-local dates; convert their nominal US close to UTC.
  const target=Date.parse(date+"T16:00:00Z");
  let utc=target;
  const format=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  for(let n=0;n<3;n++) {
    const p=Object.fromEntries(format.formatToParts(new Date(utc)).map(p=>[p.type,p.value]));
    const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    utc += target-local;
  }
  return utc;
}
export function normalizeBars(body:any,i:Instrument,r:HistoryRequest, adjustment:Observation["adjustment"], now=Date.now()): Observation[] {
  verifyMeta(body.meta,i);
  if(body.meta.interval!==r.interval || !Array.isArray(body.values)) throw new ProviderError("Invalid time-series response.");
  const {from,to}=checkedRange(r);
  const observations=body.values.map((v:any) => {
    const timestamp=r.interval==="1day" ? dailyCloseUtc(v.datetime,body.meta.exchange_timezone || "America/New_York")
      : Date.parse(String(v.datetime).replace(" ","T")+"Z")+intervalMs[r.interval];
    if(!Number.isFinite(timestamp)) throw new ProviderError("Invalid market-data timestamp.");
    return { instrumentId:i.id,provider:"twelve",price:decimal(v.close,"Market price",0.00000001),timestamp:new Date(timestamp).toISOString(),receivedAt:new Date(now).toISOString(),interval:r.interval,adjustment };
  }).filter((o:Observation)=>{const t=Date.parse(o.timestamp);return t>=from && t<=to && t<=now;}).sort((a:Observation,b:Observation)=>a.timestamp.localeCompare(b.timestamp));
  if(observations.some((o:Observation,n:number)=>n>0&&o.timestamp===observations[n-1].timestamp)) throw new ProviderError("Duplicate timestamps from provider.");
  return observations;
}
export function twelveProvider(key:string | undefined, reserve:()=>void, transport:Transport=fetch): MarketDataProvider {
  const cache=new Map<string,{until:number,data:any}>();
  const inFlight=new Map<string,Promise<any>>();
  let nextTry=0, failures=0;
  async function request(path:string,params:Record<string,string>,ttl=300000): Promise<any> {
    if(!key) throw new ProviderError("Add a Twelve Data API key in Hosty's Trading Lab configuration and restart the app.");
    const cacheKey=path+JSON.stringify(params), cached=cache.get(cacheKey);
    if(cached && cached.until>Date.now()) return cached.data;
    if(inFlight.has(cacheKey)) return inFlight.get(cacheKey);
    const pending=(async()=>{
      if(Date.now()<nextTry) throw new ProviderError("Market provider is backing off after an error. Collection will retry automatically.",503);
      reserve();
      const url=new URL(path,"https://api.twelvedata.com");
      for(const [name,value] of Object.entries(params)) url.searchParams.set(name,value);
      let response:Response, data:any;
      try {
        response=await transport(url,{headers:{authorization:`apikey ${key}`},redirect:"error",signal:AbortSignal.timeout(10000)});
        data=await response.json();
      } catch { failures++;nextTry=Date.now()+Math.min(900000,30000*2**Math.min(failures,5));throw new ProviderError("Market data could not be reached. Automatic retry is scheduled.",503); }
      if(!response.ok || data?.status==="error") {
        const status=Number(data?.code ?? response.status);
        if(status===429 || status>=500) {failures++;nextTry=Date.now()+Math.min(900000,30000*2**Math.min(failures,5));}
        // Do not reflect upstream messages/URLs: some providers include credentials.
        throw new ProviderError(status===429 ? "Market-data quota reached. Waiting before retry." : status===401 || status===403 ? "The market-data key or subscription does not allow this request." : "The provider rejected this dataset request.",status>=500?503:422);
      }
      failures=0;nextTry=0;
      if(cache.size>200) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey,{until:Date.now()+ttl,data});return data;
    })();
    inFlight.set(cacheKey,pending);
    try{return await pending;}finally{inFlight.delete(cacheKey);}
  }
  const provider:MarketDataProvider={
    info:{id:"twelve",name:"Twelve Data",kind:"market",configured:!!key,live:true,history:true,search:true,intervals:["1min","5min","1day"],pollSeconds:300,description:"US stocks in USD. Five-minute collection of completed one-minute closes. Free-plan budgets are shared across all users; available history depends on your subscription."},
    async search(query) {
      if(!query.trim()) return [];
      const data=await request("/symbol_search",{symbol:query.trim().slice(0,40),outputsize:"30"},86400000);
      if(!Array.isArray(data.data)) throw new ProviderError("Invalid instrument-search response.");
      return data.data.filter((r:any)=>r.currency==="USD"&&["Common Stock","ETF"].includes(r.instrument_type)).flatMap((r:any)=>{try{return [instrument(r)];}catch{return [];}});
    },
    async resolve(id) {
      const parts=id.split(":");
      if(parts.length!==4 || parts[0]!=="twelve") throw new ProviderError("Invalid instrument.");
      const data=await provider.search(parts[2],"");
      const match=data.find(i=>i.id===id);if(!match) throw new ProviderError("The selected instrument is unavailable.");return match;
    },
    async latest(i) {
      const body=await request("/time_series",{symbol:i.symbol,exchange:i.exchange,interval:"1min",outputsize:"3",timezone:"UTC",adjust:"none",order:"asc"});
      const now=Date.now();
      const rows=normalizeBars(body,i,{from:new Date(now-15*60000).toISOString(),to:new Date(now).toISOString(),interval:"1min"},"raw",now);
      return rows.at(-1) ?? null;
    },
    async history(i,r) {
      checkedRange(r);
      const body=await request("/time_series",{symbol:i.symbol,exchange:i.exchange,interval:r.interval,start_date:r.from.slice(0,19),end_date:r.to.slice(0,19),outputsize:"5000",timezone:"UTC",adjust:"splits",order:"asc"});
      if(body.values?.length===5000) throw new ProviderError("The provider reached the 5,000-bar limit. Narrow the range to avoid a truncated replay.");
      return {observations:normalizeBars(body,i,r,"split-adjusted"),warnings:["Price-return simulation: split-adjusted history, no dividends or taxes. Missing periods are not filled.",...(r.interval==="1day"?["Daily bars use a nominal 16:00 exchange close for ordering, including early-close sessions. Intraday moves cannot be reconstructed."]:[])]};
    }
  };return provider;
}
