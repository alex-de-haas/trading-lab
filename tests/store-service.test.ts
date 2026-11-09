import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { TradingService,newExperiment,usMarketWindow,present } from "../src/service.js";
import { deposit,addPool,processObservation,equity } from "../src/engine.js";
import { demoInstruments,demoProvider,demoObservation } from "../src/providers/demo.js";
import { defaults } from "../src/model.js";
import { ProviderError } from "../src/providers/types.js";
test("transaction rollback preserves money and append-only ledger",()=>{
 const s=new Store(":memory:");try{
  const e=newExperiment({name:"Test",provider:"demo",currency:"USD",mode:"paper"});deposit(e,100);s.create("alice",e);
  assert.throws(()=>s.update("alice",e.id,x=>{deposit(x,50);throw new Error("fail");}),/fail/);
  assert.equal(s.get("alice",e.id).balance,"100");assert.equal(s.get("alice",e.id).ledger.length,1);
  assert.throws(()=>s.update("alice",e.id,x=>{x.ledger[0].amount="999";}),/immutable/);
  assert.equal(s.get("alice",e.id).ledger[0].amount,"100");
 }finally{s.close();}
});
test("owner boundaries apply to experiments and CSV datasets",()=>{
 const s=new Store(":memory:"),v=new TradingService(s);try{
  const e=v.create("alice",{name:"private",provider:"demo",currency:"USD",initialFunds:"100"});
  assert.throws(()=>s.get("bob",e.id),/not found/);assert.deepEqual(s.list("bob"),[]);
  const data=v.importCsv("alice",{name:"Prices",symbol:"TEST",exchange:"TEST",currency:"USD",interval:"1day",adjustment:"raw",csv:"timestamp,close\n2026-01-01T00:00:00Z,100\n2026-01-02T00:00:00Z,101"});
  assert.equal(s.dataset("bob",data.instrument.id),undefined);assert.equal(s.datasets("alice").length,1);
 }finally{s.close();}
});
test("persisted fills survive reopening and duplicate observations cannot trade twice",()=>{
 const dir=mkdtempSync(join(tmpdir(),"trading-store-test-")),file=join(dir,"test.sqlite");
 let s=new Store(file);
 try{
  const e=newExperiment({name:"Persist",provider:"demo",currency:"USD",mode:"paper"});deposit(e,100);
  const p=addPool(e,demoInstruments[0],{...defaults,fixedFee:"0",feePct:"0",slippagePct:"0"},100,"pool");s.create("alice",e);
  const now=Date.now();
  for(const [n,price] of [100,101,100].entries())s.update("alice",e.id,x=>processObservation(x,x.pools[0],{...demoObservation(demoInstruments[0],now+n*60000),price:String(price)}));
  const before=s.get("alice",e.id);s.close();s=new Store(file);
  assert.equal(s.get("alice",e.id).pools[0].position?.quantity,"1");
  s.update("alice",e.id,x=>processObservation(x,x.pools[0],before.pools[0].last!));
  assert.equal(s.get("alice",e.id).ledger.length,before.ledger.length);assert.equal(equity(s.get("alice",e.id)),equity(before));
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test("restart cancels queued orders and records a gap without imaginary fills",async()=>{
 const s=new Store(":memory:"),service=new TradingService(s);try{
  const e=service.create("a",{name:"Restart",provider:"demo",currency:"USD",initialFunds:"1000"});
  await service.addPool("a",e.id,{instrumentId:demoInstruments[0].id,config:defaults,amount:"100"});
  s.update("a",e.id,x=>{x.pools[0].pending="buy";});
  new TradingService(s).recover();
  const recovered=s.get("a",e.id);assert.equal(recovered.pools[0].pending,null);assert.equal(recovered.pools[0].position,null);assert.equal(recovered.ledger.at(-1)?.type,"gap");
 }finally{s.close();}
});
test("multiple users tracking one instrument share a single upstream request",async()=>{
 const s=new Store(":memory:"),service=new TradingService(s);try{
  for(const user of ["a","b"]){const e=service.create(user,{name:"Shared",provider:"demo",currency:"USD",initialFunds:"1000"});await service.addPool(user,e.id,{instrumentId:demoInstruments[0].id,config:defaults,amount:"100"});}
  let calls=0;service.providers.get=()=>({...demoProvider,async latest(i){calls++;return demoObservation(i,Date.now());}});
  await service.tick();assert.equal(calls,1);assert.equal(s.list("a")[0].pools[0].prices.length,1);assert.equal(s.list("b")[0].pools[0].prices.length,1);
 }finally{s.close();}
});
test("replay is isolated from paper funds and keeps final positions open",async()=>{
 const s=new Store(":memory:"),v=new TradingService(s);try{
  const paper=v.create("a",{name:"Paper",provider:"demo",currency:"USD",initialFunds:"1000"});
  const result=await v.replay("a",{name:"Replay",provider:"demo",currency:"USD",initialFunds:"1000",amount:"100",instrumentId:demoInstruments[0].id,config:defaults,from:"2026-01-01T00:00:00Z",to:"2026-01-02T00:00:00Z",interval:"5min"});
  assert.equal(s.get("a",paper.id).balance,"1000");assert.ok(result.replay!.samples>100);assert.throws(()=>v.mutate("a",result.id,{action:"deposit",amount:1}),/immutable/);
  assert.ok(result.replay!.benchmark);assert.ok(result.replay!.maxDrawdown);
 }finally{s.close();}
});
test("US collection window respects DST, weekends and off-hours",()=>{
 assert.equal(usMarketWindow(Date.parse("2026-11-04T15:00:00Z")),true);
 assert.equal(usMarketWindow(Date.parse("2026-07-01T13:45:00Z")),true);
 assert.equal(usMarketWindow(Date.parse("2026-11-07T16:00:00Z")),false);
 assert.equal(usMarketWindow(Date.parse("2026-11-04T23:00:00Z")),false);
});

test("displayed open-position P&L includes both fees and excludes pending top-ups",()=>{
 const e=newExperiment({name:"Marked",provider:"demo",currency:"USD",mode:"paper"});deposit(e,1000);
 const p=addPool(e,demoInstruments[0],{...defaults,fixedFee:"1",feePct:"0",slippagePct:"0"},100,"p");
 for(const [n,price] of [100,101,100,110].entries())processObservation(e,p,{...demoObservation(demoInstruments[0],Date.UTC(2026,0,1)+n*60000),price:String(price)});
 const marked=present(e).pools[0];assert.equal(marked.positionValue,"107.8");assert.equal(marked.netPositionValue,"106.8");assert.equal(marked.unrealized,"7.8");
 p.pendingCash="25";assert.equal(present(e).pools[0].unrealized,"7.8");
});
test("data locks survive provider notices, ordinary pauses and a store restart",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"trading-data-lock-test-")),file=join(dir,"test.sqlite");
 let s=new Store(file);
 try{
  const e=newExperiment({name:"Locked",provider:"demo",currency:"USD",mode:"paper"});deposit(e,100);
  addPool(e,demoInstruments[0],{...defaults,fixedFee:"0",feePct:"0",slippagePct:"0"},100,"pool");s.create("alice",e);
  const now=Date.now();
  for(const [n,price] of [100,101,100,50].entries())s.update("alice",e.id,x=>processObservation(x,x.pools[0],{...demoObservation(demoInstruments[0],now+n*60000),price:String(price)}));
  const service=new TradingService(s);
  service.mutate("alice",e.id,{action:"pause",poolId:"pool"});
  service.providers.get=()=>({...demoProvider,async latest(){throw new ProviderError("Temporary market-data failure.");}});
  await service.tick();
  assert.equal(s.get("alice",e.id).pools[0].notice,"Temporary market-data failure.");
  assert.throws(()=>service.mutate("alice",e.id,{action:"resume",poolId:"pool"}),/unresolved market data/);
  s.close();s=new Store(file);const restarted=new TradingService(s);restarted.recover();
  const recovered=s.get("alice",e.id).pools[0];
  assert.equal(recovered.unresolvedData,true);assert.equal(recovered.status,"paused");assert.equal(recovered.last?.price,"100");
  assert.throws(()=>restarted.mutate("alice",e.id,{action:"resume",poolId:"pool"}),/unresolved market data/);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test("legacy pools restore data locks from the immutable ledger after notices were overwritten",()=>{
 const s=new Store(":memory:");
 try{
  const e=newExperiment({name:"Legacy lock",provider:"demo",currency:"USD",mode:"paper"});deposit(e,100);
  const p=addPool(e,demoInstruments[0],defaults,100,"pool"),now=Date.now();
  processObservation(e,p,{...demoObservation(demoInstruments[0],now),price:"100"});
  processObservation(e,p,{...demoObservation(demoInstruments[0],now+60000),price:"50"});
  delete (p as Partial<typeof p>).unresolvedData;
  p.notice="Temporary market-data failure.";p.status="running";p.pending="buy";
  s.create("alice",e);
  for(const restored of [s.get("alice",e.id),s.list("alice")[0],s.allPaper()[0].state]){
   assert.equal(restored.pools[0].unresolvedData,true);assert.equal(restored.pools[0].status,"paused");assert.equal(restored.pools[0].pending,null);
  }
  const service=new TradingService(s);service.recover();
  assert.throws(()=>service.mutate("alice",e.id,{action:"resume",poolId:"pool"}),/unresolved market data/);
  service.mutate("alice",e.id,{action:"pause",poolId:"pool"});
  assert.equal(s.get("alice",e.id).pools[0].unresolvedData,true);
 }finally{s.close();}
});
