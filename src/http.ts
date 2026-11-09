import type { IncomingMessage, ServerResponse } from "node:http";
import { createHostySessionResponse } from "@hosty-sdk/app/session/server";
import { createHostyUiResponse } from "@hosty-sdk/app/ui/server";
import * as identity from "../auth.js";
import { InputError } from "./engine.js";
import { ProviderError } from "./providers/types.js";
import { present, TradingService } from "./service.js";
export async function body(request:IncomingMessage,maxBytes=2_100_000){
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>maxBytes)throw new InputError("Request too large.");chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value;}catch{throw new InputError("Expected a JSON object.");}
}
export function createHandler(service:TradingService,assets:Map<string,{contentType:string,body:string|Uint8Array}>,auth=identity){
 return async(request:IncomingMessage,response:ServerResponse)=>{
  const send=(status:number,value:unknown)=>{
    if(response.writableEnded)return;
    response.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});response.end(JSON.stringify(value));
  };
  response.setHeader("x-content-type-options","nosniff");response.setHeader("referrer-policy","no-referrer");
  try{
    const url=new URL(request.url??"/","http://"+request.headers.host);
    if(request.method==="GET"&&url.pathname==="/healthz")return send(200,{status:"ok"});
    const asset=assets.get(url.pathname);
    if(request.method==="GET"&&asset){response.setHeader("content-type",asset.contentType);response.setHeader("cache-control","no-cache");response.end(asset.body);return;}
    if(request.method==="POST"){
      const origin=request.headers.origin;
      if(!origin||new URL(origin).host!==request.headers.host)return send(403,{message:"Same-origin request required."});
      if(!request.headers["content-type"]?.startsWith("application/json"))return send(415,{message:"Use application/json."});
    }
    if(request.method==="POST"&&url.pathname==="/api/auth/app-code"){
      const input=await body(request,65536);
      if(typeof input.code!=="string"||typeof input.codeVerifier!=="string")throw new InputError("Invalid sign-in response.");
      const result=await auth.exchangeLaunchCode(input.code,input.codeVerifier,request.headers["x-forwarded-proto"]==="https");
      if(!result.ok)return send(result.status,result);
      response.setHeader("set-cookie",result.setCookie);return send(200,{accessToken:result.accessToken,expiresInSeconds:result.expiresInSeconds,activeUntil:result.activeUntil});
    }
    const token=auth.readAppCredential(request),session=await auth.resolveAppSession(token);
    if(request.method==="GET"&&url.pathname==="/api/auth/identity")return send(200,{...session,...(session.status==="active"?session.identity:{}),recovery:await auth.getAppRecoveryParams()});
    if(request.method==="GET"&&url.pathname==="/api/hosty/session"){
      const result=await createHostySessionResponse(session,await auth.getAppRecoveryParams());return send(result.status,await result.json());
    }
    if(url.pathname.startsWith("/api/hosty/ui/")){
      const result=await createHostyUiResponse(new Request(url,{method:request.method,headers:Object.fromEntries(Object.entries(request.headers).filter((v):v is [string,string]=>typeof v[1]==="string")),body:request.method==="POST"?JSON.stringify(await body(request,12*1024*1024)):undefined}),{session,token});
      response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));return;
    }
    if(session.status!=="active")return send(session.status==="forbidden"?403:session.status==="unavailable"||session.status==="misconfigured"?503:401,{message:"Sign in through Hosty to access your experiments.",status:session.status});
    const owner=session.identity.userId;
    if(request.method==="GET"&&url.pathname==="/api/providers")return send(200,service.providers.list());
    if(request.method==="GET"&&url.pathname==="/api/instruments"){
      const query=url.searchParams.get("q")??"";if(query.length>80)throw new InputError("Search is too long.");
      return send(200,await service.providers.get(url.searchParams.get("provider")??"demo").search(query,owner));
    }
    if(request.method==="GET"&&url.pathname==="/api/experiments")return send(200,service.list(owner));
    if(request.method==="POST"&&url.pathname==="/api/experiments")return send(201,service.create(owner,await body(request)));
    if(request.method==="POST"&&url.pathname==="/api/imports")return send(201,service.importCsv(owner,await body(request)));
    if(request.method==="POST"&&url.pathname==="/api/replays")return send(201,await service.replay(owner,await body(request)));
    const match=url.pathname.match(/^\/api\/experiments\/([a-z0-9-]+)(?:\/(pools|actions|events|export))?$/);
    if(match){
      const [,id,action]=match;
      if(request.method==="GET"&&action==="events"){
        const initial=service.store.get(owner,id);
        response.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-store","connection":"keep-alive","x-accel-buffering":"no"});
        const emit=(e:typeof initial)=>{if(response.writableLength>1_000_000){response.end();return;}if(!response.destroyed&&!response.writableEnded)response.write("data: "+JSON.stringify(present(e))+"\n\n");};
        emit(initial);
        const unsubscribe=service.subscribe(owner,id,emit);
        let checking=false;
        const heartbeat=setInterval(async()=>{
          if(checking)return;checking=true;
          try{const current=await auth.resolveAppSession(token);if(current.status!=="active"||current.identity.userId!==owner){response.end();return;}response.write(": keep-alive\n\n");}
          catch{response.end();}finally{checking=false;}
        },20000);
        response.on("close",()=>{clearInterval(heartbeat);unsubscribe();});return;
      }
      if(request.method==="GET"&&action==="export"){
        const e=service.store.get(owner,id);response.setHeader("content-disposition",`attachment; filename="trading-lab-${e.id}.json"`);return send(200,present(e));
      }
      if(request.method==="GET"&&!action)return send(200,present(service.store.get(owner,id)));
      if(request.method==="POST"&&action==="pools")return send(200,await service.addPool(owner,id,await body(request)));
      if(request.method==="POST"&&action==="actions")return send(200,service.mutate(owner,id,await body(request)));
    }
    send(404,{message:"Not found."});
  }catch(error){
    if(response.headersSent){response.end();return;}
    if(error instanceof InputError || error instanceof ProviderError)return send(error instanceof ProviderError?error.status:400,{message:error.message});
    send(500,{message:"The operation could not be completed. No partial transaction was saved."});
  }
 };
}
