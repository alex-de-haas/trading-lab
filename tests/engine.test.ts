import test from "node:test";
import assert from "node:assert/strict";
import { addPool, D, deposit, equity, InputError, liquidation, pause, processObservation, resume, strategy, topup, buyAndHold } from "../src/engine.js";
import { newExperiment } from "../src/service.js";
import { demoInstruments } from "../src/providers/demo.js";
import { defaults, type Observation, type Strategy } from "../src/model.js";
const zero:Strategy={entryPct:"1",exitPct:"1",fixedFee:"0",feePct:"0",slippagePct:"0"};
export function fixture(config=zero) {
 const e=newExperiment({name:"Test",currency:"USD",provider:"demo",mode:"replay"});deposit(e,"1000","2026-01-01T00:00:00Z");
 const p=addPool(e,demoInstruments[0],config,"100","pool","2026-01-01T00:00:00Z");let index=0;
 const tick=(price:string|number,extra:Partial<Observation>={})=>{
   const obs:Observation={instrumentId:p.instrument.id,provider:"demo",price:String(price),timestamp:new Date(Date.parse("2026-01-01T00:00:00Z")+(++index)*60000).toISOString(),receivedAt:"2026-01-02T00:00:00Z",interval:"1min",adjustment:"raw",...extra};
   return processObservation(e,p,obs);
 };return {e,p,tick};
}
test("falling prices wait; entry uses running low, not previous close",()=>{
 const {p,tick}=fixture();[110,100,90,90.8].forEach(n=>tick(n));assert.equal(p.position,null);assert.equal(p.pending,null);
 tick(90.9);assert.equal(p.pending,"buy");assert.equal(p.position,null);tick(95);assert.equal((p.position as import("../src/model.js").Position | null)?.entryPrice,"95");
});
test("net cycle profit goes to wallet without compounding",()=>{
 const {e,p,tick}=fixture();[100,101,100,103,101,102].forEach(n=>tick(n));
 assert.equal(p.cash,"100");assert.equal(p.swept,"2");assert.equal(e.balance,"902");assert.equal(equity(e),"1002");
 assert.equal(e.ledger.find(r=>r.type==="sell")?.pnl,"2");
});
test("loss shrinks pool; later profit is swept without restoring the loss",()=>{
 const {e,p,tick}=fixture();[100,101,100,99,98].forEach(n=>tick(n));assert.equal(p.cash,"98");assert.equal(e.balance,"900");
 [99,100,103,101,102].forEach(n=>tick(n));assert.equal(p.cash,"98");assert.equal(p.swept,"1.96");assert.equal(e.balance,"901.96");assert.equal(equity(e),"999.96");
});
test("top-up while holding is excluded from profit and used next cycle",()=>{
 const {e,p,tick}=fixture();[100,101,100].forEach(n=>tick(n));topup(e,p,"40");
 assert.equal(p.pendingCash,"40");assert.equal(p.position?.quantity,"1");[103,101,102].forEach(n=>tick(n));
 assert.equal(p.cash,"140");assert.equal(p.swept,"2");assert.equal(p.pendingCash,"0");assert.equal(equity(e),"1002");
});
test("both fees and slippage reduce returns and exit fee is reserved",()=>{
 const {e,p,tick}=fixture({...zero,fixedFee:"1",feePct:"0.1",slippagePct:"0.2"});
 [100,101,100].forEach(n=>tick(n));assert.ok(D(p.cash).gte(1));assert.equal((p.position as import("../src/model.js").Position | null)?.entryPrice,"100.2");
 [103,101,102].forEach(n=>tick(n));assert.ok(D(p.fees).gt(2));assert.ok(D(equity(e)).lt(1002));assert.ok(D(p.cash).gte(0));
});
test("tiny budget declines the buy instead of borrowing from wallet",()=>{
 const {e,p,tick}=fixture({...zero,fixedFee:"51"});[100,101,100].forEach(n=>tick(n));
 assert.equal(p.status,"paused");assert.equal(p.position,null);assert.equal(e.balance,"900");assert.equal(p.cash,"100");
});
test("net liquidation consumes reserved exit fee even when position value is tiny",()=>{
 const {e,p,tick}=fixture({...zero,fixedFee:"2"});[100,101,100].forEach(n=>tick(n));
 tick(".001");assert.ok(liquidation(p).lt(0));assert.ok(D(equity(e)).gte(900));assert.ok(D(equity(e)).lt(901));
 tick(".001");assert.ok(D(p.cash).gte(0));assert.equal(e.balance,"900");
});
test("duplicate and older observations cannot execute a queued order",()=>{
 const {p,tick}=fixture();tick(100);tick(101);const timestamp=p.last!.timestamp;
 assert.equal(tick(110,{timestamp}),false);assert.equal(p.position,null);
 assert.equal(tick(110,{timestamp:"2025-01-01T00:00:00Z"}),false);assert.equal(p.position,null);
 tick(110);assert.equal((p.position as import("../src/model.js").Position | null)?.entryPrice,"110");
});
test("invalid prices and foreign provenance are rejected before state changes",()=>{
 const {p,tick}=fixture();for(const price of ["NaN","Infinity","-1","0"])assert.throws(()=>tick(price),InputError);
 assert.throws(()=>tick(100,{provider:"twelve"}),/provenance/);assert.equal(p.last,null);
});
test("trailing high rises; signal remains pending until a subsequent price",()=>{
 const {p,tick}=fixture();[100,101,100,110,120,118.8].forEach(n=>tick(n));assert.equal(p.position?.high,"120");assert.equal(p.pending,"sell");
 tick(115);assert.equal(p.position,null);assert.equal(p.swept,"15");
});
test("pause cancels pending order; resume waits for a new observation",()=>{
 const {e,p,tick}=fixture();tick(100);tick(101);pause(e,p);assert.equal(p.pending,null);tick(105);assert.equal(p.position,null);
 resume(e,p,"2026-01-01T00:10:00Z");tick(110);assert.equal(p.pending,null);assert.equal(p.low,null);
 tick(110,{timestamp:"2026-01-01T00:11:00Z"});assert.equal(p.low,"110");
});
test("adjustment changes pause trading and retain the trusted mark",()=>{
 const {e,p,tick}=fixture();tick(100);tick(101);assert.equal(p.pending,"buy");
 assert.equal(tick(102,{adjustment:"split-adjusted"}),false);
 assert.equal(p.status,"paused");assert.equal(p.unresolvedData,true);assert.equal(p.pending,null);assert.equal(p.last?.price,"101");
 assert.match(p.notice,/adjustment basis/);assert.equal(e.ledger.at(-1)?.type,"pause");
 pause(e,p);assert.throws(()=>resume(e,p),/unresolved market data/);
 assert.equal(tick(103),false);assert.equal(p.last?.price,"101");
});
test("corporate-action locks survive a subsequent ordinary pause",()=>{
 const {e,p,tick}=fixture();tick(100);tick(50,{corporateAction:true});
 assert.equal(p.status,"paused");assert.equal(p.unresolvedData,true);assert.equal(p.last?.price,"100");
 pause(e,p);assert.equal(p.notice,"Paused by user.");
 assert.throws(()=>resume(e,p),/unresolved market data/);
});
test("freshness rules reject stale and future live data",()=>{
 const {e,p}=fixture();e.mode="paper";const now=Date.parse("2026-01-01T12:00:00Z");
 const o:Observation={provider:"demo",instrumentId:p.instrument.id,price:"100",timestamp:"2026-01-01T11:00:00Z",receivedAt:"2026-01-01T12:00:00Z",interval:"1min",adjustment:"raw"};
 assert.equal(processObservation(e,p,o,now),false);assert.equal(processObservation(e,p,{...o,timestamp:"2026-01-02T12:00:00Z"},now),false);
});
test("one pool cannot spend another pool's funds",()=>{
 const {e,p}=fixture();assert.throws(()=>topup(e,p,"901"),/Insufficient/);assert.equal(p.cash,"100");assert.equal(e.balance,"900");
 assert.throws(()=>addPool(e,{...demoInstruments[0],currency:"EUR"},zero,"10","bad"),/currency/);
});
test("parameter validation prevents invalid fee rates and thresholds",()=>{
 for(const config of [{...defaults,exitPct:"100"},{...defaults,entryPct:"0"},{...defaults,feePct:"NaN"},{...defaults,slippagePct:"-1"}])assert.throws(()=>strategy(config));
});
test("buy and hold applies entry and estimated exit costs",()=>{
 assert.equal(buyAndHold("100","100","110",zero),"110");
 assert.ok(D(buyAndHold("100","100","100",{...zero,fixedFee:"1"})).eq(98));
});
test("affordable low-price purchases preserve the exit reserve and match the benchmark",()=>{
 for(const [price,config] of [
  ["0.001",{...zero,feePct:"0.1"}],
  ["1.223",{...zero,feePct:"0.1"}],
  ["0.00000001",{...zero,fixedFee:"1",feePct:"20",slippagePct:"20"}],
 ] as const){
  const {e,p,tick}=fixture(config);
  tick(price);tick(D(price).mul(2).toString());tick(price);
  assert.equal(p.status,"running");assert.ok(p.position,`An affordable purchase at ${price} must fill.`);
  assert.ok(D(p.position.quantity).gt(0));assert.ok(D(p.cash).gte(config.fixedFee));
  assert.ok(D(p.position.cost).plus(config.fixedFee).lte(100));
  const last=D(price).mul(2).toString();tick(last);
  const benchmark=buyAndHold("100",price,last,config);
  assert.notEqual(benchmark,"100");assert.equal(benchmark,D(equity(e)).minus(900).toFixed());
 }
 assert.ok(D(buyAndHold("100","1.223","2.446",{...zero,feePct:"0.1"})).gt("199.6"));
});
test("equity reconciles with realized and unrealized P&L over many trades",()=>{
 const {e,p,tick}=fixture({...zero,fixedFee:".1",feePct:".2",slippagePct:".1"});
 for(let n=0;n<500;n++){tick(100+5*Math.sin(n/3));assert.ok(D(p.cash).gte(0));assert.ok(D(e.balance).gte(900));}
 const unrealized=p.position?D(p.cash).plus(liquidation(p)).minus(p.position.capital):D(0);
 assert.ok(D(equity(e)).minus(e.deposits).minus(D(p.realized).plus(unrealized)).abs().lte("0.00000002"));
});
