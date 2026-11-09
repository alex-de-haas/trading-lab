import test from "node:test";
import assert from "node:assert/strict";
import { demoProvider,demoInstruments } from "../src/providers/demo.js";
import { parseCsv } from "../src/providers/csv.js";
import { normalizeBars,twelveProvider } from "../src/providers/twelve.js";
import { Store } from "../src/store.js";
import { processObservation,equity } from "../src/engine.js";
import { newExperiment } from "../src/service.js";
import { deposit,addPool } from "../src/engine.js";
import { defaults } from "../src/model.js";
const i={id:"twelve:NASDAQ:AAPL:USD",provider:"twelve",symbol:"AAPL",name:"Apple",exchange:"NASDAQ",mic:"XNAS",currency:"USD" as const};
const range={from:"2026-01-01T00:00:00Z",to:"2026-01-02T00:00:00Z",interval:"1min" as const};
test("CSV strictly validates dates, order, prices and source basis",()=>{
 const instrument={...demoInstruments[0],provider:"csv",id:"csv:test"};
 assert.equal(parseCsv("timestamp,close\n2026-01-01T00:00:00Z,100\n2026-01-01T00:01:00Z,101",instrument,"1min","raw").observations[1].price,"101");
 for(const csv of ["timestamp,close\n2026-02-30T00:00:00Z,100\n2026-03-03T00:00:00Z,101","timestamp,close\n2026-01-01,100\n2026-01-02,100","timestamp,close\n2026-01-01T00:00:00Z,100\n2026-01-01T00:00:00Z,101","timestamp,close\n2026-01-01T00:00:00Z,NaN\n2026-01-01T00:01:00Z,101"])assert.throws(()=>parseCsv(csv,instrument,"1min","raw"));
});
test("demo history is deterministic and bounded",async()=>{
 const r={...range,interval:"5min" as const};
 const a=await demoProvider.history(demoInstruments[0],r,"a"),b=await demoProvider.history(demoInstruments[0],r,"b");
 assert.deepEqual(a.observations.map(o=>o.price),b.observations.map(o=>o.price));
 await assert.rejects(()=>demoProvider.history(demoInstruments[0],{...range,to:"2026-05-01T00:00:00Z"},"a"),/5,000/);
});
test("equivalent demo and CSV data produce identical accounting",async()=>{
 const data=await demoProvider.history(demoInstruments[0],{...range,interval:"5min"},"a");
 const csv="timestamp,close\n"+data.observations.map(o=>o.timestamp+","+o.price).join("\n");
 const imported={...demoInstruments[0],provider:"csv",id:"csv:equivalent"};
 const feed=parseCsv(csv,imported,"5min","raw");
 const results=[["demo",demoInstruments[0],data],["csv",imported,feed]] as const;
 const values=results.map(([provider,instrument,history])=>{
  const e=newExperiment({name:"test",currency:"USD",provider,mode:"replay"});deposit(e,100);const p=addPool(e,instrument,defaults,100,"pool");
  history.observations.forEach(o=>processObservation(e,p,o));return {equity:equity(e),cash:p.cash,fees:p.fees,swept:p.swept};
 });assert.deepEqual(values[0],values[1]);
});
test("completed bar timestamps avoid using a close before it is known",()=>{
 const body={meta:{...i,interval:"1min",mic_code:"XNAS"},values:[{datetime:"2026-01-01 15:00:00",close:"100"}]};
 const out=normalizeBars(body,i,range,"raw");assert.equal(out[0].timestamp,"2026-01-01T15:01:00.000Z");
 assert.equal(normalizeBars(body,i,range,"raw",Date.parse("2026-01-01T15:00:30Z")).length,0);
});
test("daily dates are converted from exchange time with DST",()=>{
 const meta={...i,interval:"1day",mic_code:"XNAS",exchange_timezone:"America/New_York"};
 const r={from:"2026-01-01T00:00:00Z",to:"2026-12-31T00:00:00Z",interval:"1day" as const};
 const out=normalizeBars({meta,values:[{datetime:"2026-07-01",close:"100"},{datetime:"2026-11-04",close:"100"}]},i,r,"split-adjusted",Date.parse("2027-01-01"));
 assert.equal(out[0].timestamp,"2026-07-01T20:00:00.000Z");assert.equal(out[1].timestamp,"2026-11-04T21:00:00.000Z");
});
test("market adapter rejects wrong currency, identity and duplicate data",()=>{
 const body={meta:{...i,interval:"1min"},values:[{datetime:"2026-01-01 15:00:00",close:"100"}]};
 assert.throws(()=>normalizeBars({...body,meta:{...body.meta,currency:"EUR"}},i,range,"raw"));
 assert.throws(()=>normalizeBars({...body,values:[...body.values,...body.values]},i,range,"raw"),/Duplicate/);
});
test("missing API key is explicit and does not attempt network",async()=>{
 let called=false;const p=twelveProvider(undefined,()=>{},async()=>{called=true;throw new Error();});
 await assert.rejects(()=>p.search("AAPL","a"),/API key/);assert.equal(called,false);
});
test("concurrent market requests are shared; key stays in server header",async()=>{
 let calls=0,reserved=0;
 const p=twelveProvider("private-test-key",()=>reserved++,async(url,init)=>{
  calls++;assert.equal(String(url).includes("private-test-key"),false);assert.equal((init?.headers as any).authorization,"apikey private-test-key");
  await new Promise(r=>setTimeout(r,10));return Response.json({data:[{symbol:"AAPL",instrument_name:"Apple",exchange:"NASDAQ",mic_code:"XNAS",currency:"USD",instrument_type:"Common Stock"}]});
 });
 const result=await Promise.all([p.search("AAPL","a"),p.search("AAPL","b")]);assert.equal(calls,1);assert.equal(reserved,1);assert.equal(result[0][0].id,i.id);
});
test("provider errors are redacted and quota errors back off",async()=>{
 let calls=0;const p=twelveProvider("secret-key",()=>{},async()=>{calls++;return Response.json({status:"error",code:429,message:"url?apikey=secret-key"},{status:429});});
 await assert.rejects(()=>p.search("AAPL","a"),/quota/);
 await assert.rejects(()=>p.search("MSFT","a"),/backing off/);assert.equal(calls,1);
});
test("persisted per-minute quota rolls back daily reservation on refusal",()=>{
 const store=new Store(":memory:"),now=Date.parse("2026-01-01T12:00:00Z");
 try{for(let n=0;n<8;n++)store.reserveTwelve(now);assert.throws(()=>store.reserveTwelve(now),/budget/);store.reserveTwelve(now+60000);}
 finally{store.close();}
});
