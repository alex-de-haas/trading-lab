import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Store } from "../src/store.js";
import { TradingService } from "../src/service.js";
import { createHandler } from "../src/http.js";
import * as auth from "../auth.js";
import { demoInstruments } from "../src/providers/demo.js";
import { defaults } from "../src/model.js";
test("HTTP API denies anonymous requests, isolates users and handles concurrent allocations atomically",async()=>{
 const store=new Store(":memory:"),service=new TradingService(store);
 const fixtureAuth={...auth,async resolveAppSession(token:string|null):Promise<auth.AppSessionResult>{
  return token?.startsWith("hostyg_fixture_")?{status:"active",identity:{userId:token,hostRole:"host.user"}}:{status:"not-present"};
 }};
 const server=createServer(createHandler(service,new Map(),fixtureAuth));server.listen(0,"127.0.0.1");await once(server,"listening");
 const origin="http://127.0.0.1:"+(server.address() as any).port;
 const request=(path:string,body?:unknown,user="alice",sendOrigin=true)=>fetch(origin+path,{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json",...(user?{authorization:"Bearer hostyg_fixture_"+user}:{}),...(sendOrigin?{origin}: {})},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await request("/api/experiments",undefined,"")).status,401);
  assert.equal((await request("/api/experiments",{name:"bad"},"alice",false)).status,403);
  const created=await request("/api/experiments",{name:"My wallet",provider:"demo",currency:"USD",initialFunds:"100"});
  assert.equal(created.status,201);const e:any=await created.json();
  assert.equal((await request("/api/experiments/"+e.id,undefined,"bob")).status,400);
  const payload={instrumentId:demoInstruments[0].id,config:defaults,amount:"80"};
  const results=await Promise.all([request("/api/experiments/"+e.id+"/pools",payload),request("/api/experiments/"+e.id+"/pools",payload)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  const current:any=await (await request("/api/experiments/"+e.id)).json();assert.equal(current.balance,"20");assert.equal(current.pools.length,1);
  const controller=new AbortController();
  const stream=await fetch(origin+"/api/experiments/"+e.id+"/events",{headers:{authorization:"Bearer hostyg_fixture_alice"},signal:controller.signal});
  assert.match(stream.headers.get("content-type")!,/text\/event-stream/);
  const first=await stream.body!.getReader().read();assert.match(new TextDecoder().decode(first.value),/My wallet/);controller.abort();
  assert.equal((await request("/api/experiments/"+e.id+"/events",undefined,"bob")).status,400);
  const invalid=await fetch(origin+"/api/experiments",{method:"POST",headers:{origin,authorization:"Bearer hostyg_fixture_alice","content-type":"application/json"},body:"not json"});
  assert.equal(invalid.status,400);
 }finally{server.closeAllConnections();server.close();await once(server,"close");store.close();}
});
test("ordinary Hosty identity rejects a grant for a different app and preserves temporary failures",async()=>{
 const priorFetch=globalThis.fetch,prior={...process.env};
 process.env.HOSTY_APP_ID="com.test.lab";process.env.HOSTY_CORE_ORIGIN="http://core.test";process.env.HOSTY_APP_SERVICE_TOKEN="fixture-only";
 try{
  globalThis.fetch=async()=>Response.json({active:true,appId:"different.app",userId:"alice"});
  assert.equal((await auth.resolveAppSession("hostyg_fixture")).status,"unavailable");
  globalThis.fetch=async()=>Response.json({}, {status:503});assert.equal((await auth.resolveAppSession("hostyg_fixture")).status,"unavailable");
  globalThis.fetch=async()=>Response.json({}, {status:403});assert.equal((await auth.resolveAppSession("hostyg_fixture")).status,"forbidden");
 }finally{globalThis.fetch=priorFetch;for(const key of ["HOSTY_APP_ID","HOSTY_CORE_ORIGIN","HOSTY_APP_SERVICE_TOKEN"]){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
});
