import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchModeBootstrapScript } from "@hosty-sdk/app";
import { Store } from "./src/store.js";
import { TradingService } from "./src/service.js";
import { createHandler } from "./src/http.js";
declare const TRADING_LAB_PRODUCTION: boolean;
// HOSTY_PORT_HTTP is the host-published port for Docker, not the container listener.
const configuredPort=process.env.PORT??"3000",listenPort=Number(configuredPort);
if(!/^\d+$/.test(configuredPort)||!Number.isInteger(listenPort)||listenPort<1||listenPort>65535)throw new Error("PORT must be an integer between 1 and 65535.");
const dataRoot=process.env.HOSTY_APP_DATA_DIR;
if(!dataRoot)throw new Error("HOSTY_APP_DATA_DIR is required. Start Trading Lab through Hosty.");
const store=new Store(join(dataRoot,"trading.sqlite")),service=new TradingService(store);
let client:string|Uint8Array,html=await readFile(new URL("./index.html",import.meta.url),"utf8");
if(typeof TRADING_LAB_PRODUCTION!=="undefined"&&TRADING_LAB_PRODUCTION)client=await readFile(new URL("./client.js",import.meta.url));
else{
  const {build}=await import("esbuild");
  const bundle=await build({entryPoints:[fileURLToPath(new URL("./client.tsx",import.meta.url))],bundle:true,write:false,format:"esm",jsx:"automatic",minify:true,define:{"process.env.NODE_ENV":'"production"'}});
  client=bundle.outputFiles[0].contents;
  html=html.replace("<!-- launch-mode -->",`<script>${launchModeBootstrapScript}</script>`);
}
const assets=new Map([
  ["/",{contentType:"text/html; charset=utf-8",body:html}],
  ["/client.js",{contentType:"text/javascript; charset=utf-8",body:client}],
  ["/style.css",{contentType:"text/css; charset=utf-8",body:await readFile(new URL("./style.css",import.meta.url),"utf8")}]
]);
service.recover();
const server=createServer(createHandler(service,assets));
const timer=setInterval(()=>{void service.tick().catch(()=>console.error("Market collection failed; retry scheduled."));},5000);
server.listen(listenPort,"0.0.0.0",()=>console.log("Trading Lab ready on container port "+listenPort+"."));
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,()=>{clearInterval(timer);server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(0),5000).unref();});
