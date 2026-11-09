import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
const run=promisify(execFile),root=fileURLToPath(new URL("../",import.meta.url));

async function availablePort(){
 const listener=createServer();listener.listen(0,"127.0.0.1");await once(listener,"listening");
 const port=(listener.address() as {port:number}).port;
 await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));return port;
}
async function stop(child:ChildProcess){
 if(child.exitCode!==null||child.signalCode!==null)return;
 const exit=once(child,"exit");child.kill("SIGTERM");await exit;
}
test("the packaged production service runs without source files or startup compilation",{timeout:30000},async()=>{
 const temporary=await mkdtemp(join(tmpdir(),"trading-production-test-")),app=join(temporary,"package"),output=join(app,"dist"),data=join(temporary,"data");
 let child:ChildProcess|undefined;
 try{
  await mkdir(app);await mkdir(data);
  await run(process.execPath,[join(root,"scripts/build.mjs"),output],{cwd:temporary});
  assert.deepEqual((await readdir(output)).sort(),["client.js","index.html","manifest.json","server.mjs","style.css"]);
  const compiled=await readFile(join(output,"server.mjs"),"utf8");
  assert.doesNotMatch(compiled,/import\(["']esbuild["']\)|client\.tsx/);
  await symlink(join(root,"node_modules"),join(app,"node_modules"),process.platform==="win32"?"junction":"dir");
  const port=await availablePort(),origin="http://127.0.0.1:"+port;
  const env={...process.env,PORT:String(port),HOSTY_PORT_HTTP:String(port+1),HOSTY_APP_DATA_DIR:data,HOSTY_APP_ID:"com.test.trading-production",HOSTY_CORE_ORIGIN:"",HOSTY_APP_SERVICE_TOKEN:"",TWELVE_DATA_API_KEY:""};
  const launch=()=>spawn(process.execPath,[join(output,"server.mjs")],{cwd:temporary,env,stdio:["ignore","pipe","pipe"]});
  const ready=async(process:ChildProcess)=>{
   const deadline=Date.now()+10000;let diagnostics="";
   process.stderr?.on("data",chunk=>{diagnostics+=String(chunk);});
   while(Date.now()<deadline){
    if(process.exitCode!==null)throw new Error("Production service exited: "+diagnostics);
    const response=await fetch(origin+"/healthz",{signal:AbortSignal.timeout(500)}).catch(()=>null);
    if(response?.ok){assert.deepEqual(await response.json(),{status:"ok"});return;}
    await setTimeout(25);
   }
   throw new Error("Production service did not become healthy: "+diagnostics);
  };
  child=launch();await ready(child);
  const html=await (await fetch(origin+"/")).text();assert.match(html,/<title>Trading Lab<\/title>/);assert.doesNotMatch(html,/<!-- launch-mode -->/);
  const client=await fetch(origin+"/client.js");assert.equal(client.status,200);assert.match(client.headers.get("content-type")??"",/javascript/);assert.ok((await client.text()).length>1000);
  assert.equal((await fetch(origin+"/style.css")).status,200);
  const anonymous=await fetch(origin+"/api/experiments");assert.equal(anonymous.status,401);assert.equal((await anonymous.json()).status,"not-present");
  await stop(child);child=undefined;
  assert.ok((await readdir(data)).includes("trading.sqlite"));
  child=launch();await ready(child);
  assert.equal((await fetch(origin+"/api/experiments")).status,401);
  await stop(child);child=undefined;
  for(const invalidPort of ["0","65536","not-a-port"]){
   await assert.rejects(run(process.execPath,[join(output,"server.mjs")],{cwd:temporary,env:{...env,PORT:invalidPort}}),(error:unknown)=>{
    assert.match((error as {stderr:string}).stderr,/PORT must be an integer between 1 and 65535/);return true;
   });
  }
 }finally{if(child)await stop(child);await rm(temporary,{recursive:true,force:true});}
});
