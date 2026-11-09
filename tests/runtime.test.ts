import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the default runtime delivers the production image without source setup",async()=>{
 const manifest=JSON.parse(await readFile(new URL("../manifest.json",import.meta.url),"utf8"));
 const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
 assert.equal(manifest.schemaVersion,"app.0.1");assert.equal(manifest.defaultRuntime,"docker");
 assert.deepEqual(manifest.runtimeProfiles.filter((p:any)=>p.default).map((p:any)=>p.key),["docker"]);
 const runtime=manifest.services.find((s:any)=>s.key==="web").runtimes.docker;
 assert.equal(runtime.artifact,"image");assert.deepEqual(runtime.image,{repository:"ghcr.io/alex-de-haas/trading-lab",tag:pkg.version});
 for(const field of ["sourceMount","setup","workingDirectory","command"])assert.equal(runtime[field],undefined);
 assert.equal(runtime.environment.PORT,"3000");assert.equal(runtime.ports[0].containerPort,3000);
 assert.match(runtime.healthcheck.command,/127\.0\.0\.1:3000\/healthz/);
 assert.deepEqual(manifest.data.targets.find((t:any)=>t.runtime==="docker"),{runtime:"docker",service:"web",containerPath:"/app/data",environment:"HOSTY_APP_DATA_DIR"});
 const dev=manifest.services[0].runtimes.dev;
 assert.equal(manifest.runtimeProfiles.find((p:any)=>p.key==="dev").development,true);
 assert.equal(dev.artifact,"source");assert.equal(dev.sourceMount.mode,"ro");assert.match(dev.setup,/npm ci/);assert.equal(dev.command,"node --import tsx server.ts");
 assert.equal(manifest.data.targets.find((t:any)=>t.runtime==="dev").containerPath,"/app/data");
});
