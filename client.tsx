import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppIdentityBridge, HostLaunchBridge } from "@hosty-sdk/app/react";
import { appFetch } from "@hosty-sdk/app/browser-auth";
import type { Experiment, Instrument, Pool, Strategy } from "./src/model.js";
import { defaults } from "./src/model.js";
import type { ProviderInfo } from "./src/providers/types.js";

type PoolView=Pool & {positionValue:string;netPositionValue:string;unrealized:string};
type View=Omit<Experiment,"pools"> & {pools:PoolView[]} & {totalEquity:string;netPnl:string;totalFees:string;totalSwept:string};
type Summary=Pick<View,"id"|"name"|"currency"|"provider"|"mode"|"totalEquity">;
async function api<T>(path:string,body?:unknown):Promise<T>{
 const response=await appFetch(path,body===undefined?{cache:"no-store"}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.message??"Request failed. Try again.");return data;
}
const cash=(value:string|number,currency="USD")=>new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:2}).format(Number(value));
const number=(value:string|number,digits=4)=>new Intl.NumberFormat("en-US",{maximumFractionDigits:digits}).format(Number(value));
const date=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
const today=new Date().toISOString().slice(0,10);
const startDate=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
function Field({label,children}:React.PropsWithChildren<{label:string}>){return <label className="field"><span>{label}</span>{children}</label>;}
function StrategyFields({value,onChange}:{value:Strategy;onChange:(v:Strategy)=>void}){
 return <div className="fields strategy-fields">{([
  ["entryPct","Buy after rise (%)","0.01"],["exitPct","Sell after fall (%)","0.01"],["fixedFee","Fee per transaction","0"],["feePct","Transaction fee (%)","0"],["slippagePct","Slippage per fill (%)","0"]
 ] as const).map(([key,title,min])=><Field key={key} label={title}><input type="number" min={min} step="0.01" required value={value[key]} onChange={e=>onChange({...value,[key]:e.target.value})}/></Field>)}</div>;
}
function InstrumentPicker({provider,currency,value,onChange,refresh=0}:{provider:string;currency:string;value:string;onChange:(s:string)=>void;refresh?:number}){
 const [query,setQuery]=useState(""),[items,setItems]=useState<Instrument[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const generation=useRef(0);
 const search=async(q=query)=>{const request=++generation.current;setBusy(true);setError("");try{
  const next=(await api<Instrument[]>("/api/instruments?provider="+encodeURIComponent(provider)+"&q="+encodeURIComponent(q))).filter(i=>i.currency===currency);
  if(request!==generation.current)return;
  setItems(next);onChange(next[0]?.id??"");if(!next.length)setError("No matching instruments. Try another search or import a dataset.");
 }catch(e){if(request===generation.current){setError((e as Error).message);setItems([]);onChange("");}}finally{if(request===generation.current)setBusy(false);}};
 useEffect(()=>{setItems([]);onChange("");setError("");setQuery("");setBusy(false);if(provider!=="twelve")void search("");return()=>{generation.current++;};},[provider,currency,refresh]);
 return <div className="instrument-picker">
  {provider==="twelve"&&<div className="inline"><input aria-label="Search ticker or company" placeholder="Ticker or company, e.g. AAPL" value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" className="secondary" disabled={busy||!query.trim()} onClick={()=>void search()}>Search</button></div>}
  <Field label="Instrument"><select required value={value} onChange={e=>onChange(e.target.value)}><option value="">Select an instrument</option>{items.map(i=><option value={i.id} key={i.id}>{i.symbol} — {i.name} ({i.exchange}, {i.currency})</option>)}</select></Field>
  {busy&&<p className="hint">Loading instruments…</p>}{error&&<p className="hint" role="status">{error}</p>}
 </div>;
}
function CsvImport({onImport}:{onImport:(data:any)=>void}){
 const [name,setName]=useState("Imported prices"),[symbol,setSymbol]=useState("STOCK"),[exchange,setExchange]=useState("IMPORT"),[currency,setCurrency]=useState("USD"),[interval,setInterval]=useState("1day"),[adjustment,setAdjustment]=useState("split-adjusted"),[csv,setCsv]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function upload(){setBusy(true);setError("");try{onImport(await api("/api/imports",{name,symbol,exchange,currency,interval,adjustment,csv}));setCsv("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <details className="import-box"><summary>Import a price history CSV</summary>
  <p className="hint">Required columns: <code>timestamp,close</code>. Times must be UTC, for example <code>2026-01-02T21:00:00Z,100.50</code>. Up to 5,000 rows.</p>
  <div className="fields">
   <Field label="Dataset name"><input value={name} onChange={e=>setName(e.target.value)}/></Field>
   <Field label="Symbol"><input value={symbol} onChange={e=>setSymbol(e.target.value)}/></Field>
   <Field label="Exchange"><input value={exchange} onChange={e=>setExchange(e.target.value)}/></Field>
   <Field label="Currency"><select value={currency} onChange={e=>setCurrency(e.target.value)}><option>USD</option><option>EUR</option></select></Field>
   <Field label="Bar interval"><select value={interval} onChange={e=>setInterval(e.target.value)}><option value="1min">1 minute</option><option value="5min">5 minutes</option><option value="1day">Daily</option></select></Field>
   <Field label="Price adjustment"><select value={adjustment} onChange={e=>setAdjustment(e.target.value)}><option value="split-adjusted">Split-adjusted</option><option value="raw">Raw prices</option></select></Field>
  </div>
  <Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(file){if(file.size>2_000_000)setError("CSV must be smaller than 2 MB.");else setCsv(await file.text());}}}/></Field>
  <button className="secondary" type="button" disabled={busy||!csv} onClick={()=>void upload()}>{busy?"Importing…":"Import dataset"}</button>
  {error&&<p className="error" role="alert">{error}</p>}
 </details>;
}
function NewExperiment({providers,busy,onCreate,onCancel}:{providers:ProviderInfo[];busy:boolean;onCreate:(input:any)=>void;onCancel:()=>void}){
 const [mode,setMode]=useState("replay"),[provider,setProvider]=useState("demo"),[currency,setCurrency]=useState("USD"),[name,setName]=useState("First experiment"),[funds,setFunds]=useState("1000"),[amount,setAmount]=useState("100"),[instrumentId,setInstrument]=useState(""),[config,setConfig]=useState(defaults),[from,setFrom]=useState(startDate),[to,setTo]=useState(today),[interval,setInterval]=useState("1day"),[refresh,setRefresh]=useState(0);
 const info=providers.find(p=>p.id===provider);
 return <section className="editor">
  <div className="section-title"><div><h2>New experiment</h2><p>Give the hypothesis its own wallet and data source.</p></div><button type="button" className="quiet" onClick={onCancel}>Cancel</button></div>
  <form onSubmit={e=>{e.preventDefault();onCreate({mode,provider,currency,name,initialFunds:funds,amount,instrumentId,config,from:from+"T00:00:00Z",to:to+"T23:59:59Z",interval});}}>
   <div className="fields">
    <Field label="Name"><input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></Field>
    <Field label="Mode"><select value={mode} onChange={e=>setMode(e.target.value)}><option value="replay">Historical replay</option><option value="paper">Ongoing paper trading</option></select></Field>
    <Field label="Data provider"><select value={provider} onChange={e=>{setProvider(e.target.value);if(e.target.value==="csv")setMode("replay");if(e.target.value==="twelve")setCurrency("USD");}}>{providers.map(p=><option key={p.id} value={p.id}>{p.name}{!p.configured?" (key needed)":""}</option>)}</select></Field>
    <Field label="Wallet currency"><select value={currency} disabled={provider==="twelve"} onChange={e=>setCurrency(e.target.value)}><option>USD</option><option>EUR</option></select></Field>
    <Field label="Starting virtual funds"><input required type="number" min="0.01" max="1000000000" step="0.01" value={funds} onChange={e=>setFunds(e.target.value)}/></Field>
   </div>
   <p className={"source-note "+(provider==="demo"?"synthetic":"")}>{info?.description}</p>
   {provider==="csv"&&<CsvImport onImport={d=>{setRefresh(n=>n+1);setCurrency(d.instrument.currency);setInterval(d.interval);setFrom(d.from.slice(0,10));setTo(d.to.slice(0,10));}}/>}
   {mode==="replay"&&<>
    <InstrumentPicker provider={provider} currency={currency} value={instrumentId} onChange={setInstrument} refresh={refresh}/>
    <div className="fields">
     <Field label="Pool budget"><input type="number" required min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
     <Field label="From"><input required type="date" value={from} onChange={e=>setFrom(e.target.value)}/></Field>
     <Field label="Through"><input required type="date" value={to} onChange={e=>setTo(e.target.value)}/></Field>
     <Field label="Observation interval"><select value={interval} onChange={e=>setInterval(e.target.value)}><option value="1day">Daily closes</option><option value="5min">5-minute closes</option><option value="1min">1-minute closes</option></select></Field>
    </div>
    <StrategyFields value={config} onChange={setConfig}/>
   </>}
   <div className="form-footer"><p className="hint">{mode==="replay"?"A replay has its own wallet. Changing the provider creates a new experiment.":"Collection continues while the app runs. Add trading pools after creating the wallet."}</p><button disabled={busy||!info?.configured||(mode==="replay"&&!instrumentId)||(mode==="paper"&&!info?.live)}>{busy?"Working…":mode==="replay"?"Run replay":"Create wallet"}</button></div>
  </form>
 </section>;
}
function AddPool({experiment,busy,onAdd}:{experiment:View;busy:boolean;onAdd:(input:any)=>void}){
 const [instrumentId,setInstrument]=useState(""),[amount,setAmount]=useState("100"),[config,setConfig]=useState(defaults);
 return <details className="pool-editor" open={experiment.pools.length===0?true:undefined}><summary>Add a trading pool</summary>
  <form onSubmit={e=>{e.preventDefault();onAdd({instrumentId,amount,config});}}>
   <InstrumentPicker provider={experiment.provider} currency={experiment.currency} value={instrumentId} onChange={setInstrument}/>
   <Field label={"Budget ("+experiment.currency+")"}><input required type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
   <StrategyFields value={config} onChange={setConfig}/>
   <div className="form-footer"><p className="hint">Net profit returns to the wallet. Losses reduce this pool's next budget.</p><button disabled={busy||!instrumentId}>Allocate and start</button></div>
  </form>
 </details>;
}
function Chart({experiment,pool}:{experiment:View;pool:Pool|undefined}){
 const [view,setView]=useState("price");
 const rows=view==="price"?(pool?.prices??[]).map(p=>({time:p.time,value:Number(p.price)})):experiment.equity.map(p=>({time:p.time,value:Number(p.value)}));
 const trades=view==="price"?experiment.ledger.filter(r=>r.poolId===pool?.id&&(r.type==="buy"||r.type==="sell")):[];
 const W=960,H=280,pad={left:68,right:18,top:22,bottom:38};
 const values=[...rows.map(p=>p.value),...trades.map(t=>Number(t.price))],min=Math.min(...values),max=Math.max(...values),spread=Math.max((max-min)*.12,max*.001,0.01);
 const low=min-spread,high=max+spread;
 const first=rows[0]?Date.parse(rows[0].time):0,last=rows.at(-1)?Date.parse(rows.at(-1)!.time):1;
 const x=(t:string)=>pad.left+(Date.parse(t)-first)/Math.max(last-first,1)*(W-pad.left-pad.right);
 const y=(n:number)=>pad.top+(high-n)/Math.max(high-low,.01)*(H-pad.top-pad.bottom);
 const sample=rows.filter((_,i)=>i%Math.max(1,Math.ceil(rows.length/1000))===0||i===rows.length-1);
 const path=sample.map((p,i)=>`${i?"L":"M"}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
 return <section className="chart-panel">
  <div className="section-title"><div><h2>{view==="price"?(pool?pool.instrument.symbol+" price":"Price observations"):"Total equity"}</h2><p>{view==="price"?"Buy and sell marks show actual simulated fills.":"Wallet, pools and open positions after estimated exit costs."}</p></div><div className="segmented" aria-label="Chart view"><button className={view==="price"?"selected":""} onClick={()=>setView("price")}>Price</button><button className={view==="equity"?"selected":""} onClick={()=>setView("equity")}>Equity</button></div></div>
  {rows.length<2?<div className="chart-empty">Waiting for price observations. The collector runs in the background.</div>:<svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={view==="price"?"Price history with simulated buy and sell executions":"Total net liquidation equity over time"}>
   {[0,.25,.5,.75,1].map(f=>{const v=low+(high-low)*f;return <g key={f}><line x1={pad.left} x2={W-pad.right} y1={y(v)} y2={y(v)} className="grid-line"/><text x={pad.left-10} y={y(v)+4} textAnchor="end">{number(v,2)}</text></g>;})}
   <path d={path} className="price-line"/>
   {trades.slice(-200).map(t=><g key={t.id}><circle cx={x(t.time)} cy={y(Number(t.price))} r="4.5" className={t.type==="buy"?"buy-dot":"sell-dot"}/><title>{t.type+" "+cash(t.price!,experiment.currency)+" at "+date(t.time)}</title></g>)}
   {[0,.5,1].map(f=><text key={f} x={pad.left+f*(W-pad.left-pad.right)} y={H-10} textAnchor={f===0?"start":f===1?"end":"middle"}>{last-first<86400000?new Date(first+(last-first)*f).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",second:"2-digit"}):new Date(first+(last-first)*f).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</text>)}
  </svg>}
  <div className="chart-caption"><span>{rows.length.toLocaleString()} observations{pool?.last?" · Last "+date(pool.last.timestamp):""}</span>{view==="price"&&<span className="legend"><i className="buy"/> Buy <i className="sell"/> Sell{trades.length>200?" (last 200 markers)":""}</span>}</div>
 </section>;
}
function App(){
 const [providers,setProviders]=useState<ProviderInfo[]>([]),[experiments,setExperiments]=useState<Summary[]>([]),[selected,setSelected]=useState(""),[current,setCurrent]=useState<View|null>(null),[poolId,setPoolId]=useState(""),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[connection,setConnection]=useState("Connecting"),[topupAmount,setTopup]=useState("25"),[depositAmount,setDeposit]=useState("100"),[editConfig,setEditConfig]=useState<Strategy|null>(null);
 async function refresh(){const rows=await api<Summary[]>("/api/experiments");setExperiments(rows);return rows;}
 useEffect(()=>{Promise.all([api<ProviderInfo[]>("/api/providers"),refresh()]).then(([p,rows])=>{setProviders(p);if(rows.length)setSelected(rows[0].id);}).catch(e=>setError(e.message));},[]);
 useEffect(()=>{
  if(!selected){setCurrent(null);return;}
  setCurrent(null);setPoolId("");setEditConfig(null);
  let stopped=false,controller:AbortController|undefined,retry:ReturnType<typeof setTimeout>|undefined,attempt=0,terminal=false;
  function schedule(){if(!stopped&&!terminal&&!document.hidden)retry=setTimeout(connect,Math.min(15000,1000*2**Math.min(attempt++,4)));}
  async function connect(){
   if(stopped||document.hidden||terminal)return;
   controller?.abort(); const activeController=new AbortController();controller=activeController;setConnection("Connecting");
   try{
    const response=await appFetch("/api/experiments/"+selected+"/events",{signal:activeController.signal,cache:"no-store"});
    if(!response.ok){terminal=response.status===401||response.status===403||response.status===400;throw new Error(terminal?"Sign in again or choose an accessible experiment.":"Live updates are temporarily unavailable.");}
    const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer="";
    setConnection("Connected");attempt=0;
    while(!stopped){
     const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
     if(buffer.length>12_000_000)throw new Error("The update is too large.");
     let end;
     while((end=buffer.indexOf("\n\n"))!==-1){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(event.startsWith("data: ")){
       const e=JSON.parse(event.slice(6)) as View;setCurrent(e);setExperiments(rows=>rows.map(row=>row.id===e.id?{...row,totalEquity:e.totalEquity}:row));
     }}
    }
    if(!stopped)setConnection("Reconnecting");
   }catch(e){if(!stopped&&!activeController.signal.aborted){setConnection(terminal?"Sign-in required":"Reconnecting");if(terminal)setError((e as Error).message);}}
   if(controller===activeController&&!activeController.signal.aborted)schedule();
  }
  function visibility(){if(document.hidden){controller?.abort();if(retry)clearTimeout(retry);setConnection("Updates paused while hidden");}else{controller?.abort();if(retry)clearTimeout(retry);void connect();}}
  void connect();document.addEventListener("visibilitychange",visibility);
  return()=>{stopped=true;controller?.abort();if(retry)clearTimeout(retry);document.removeEventListener("visibilitychange",visibility);};
 },[selected]);
 async function run(action:()=>Promise<View>){setBusy(true);setError("");try{const result=await action();setCurrent(result);setSelected(result.id);setCreating(false);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function mutate(input:any){if(current)void run(()=>api("/api/experiments/"+current.id+"/actions",input));}
 const pool=current?.pools.find(p=>p.id===poolId)??current?.pools[0];
 const currency=current?.currency??"USD";
 async function exportExperiment(){if(!current)return;try{const data=await api("/api/experiments/"+current.id+"/export"),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="trading-lab-"+current.id+".json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError((e as Error).message);}}
 return <div className="app-shell">
  <header className="app-header hosty-shell-chrome"><div className="brand"><span className="brand-mark" aria-hidden="true">↗</span><strong>Trading Lab</strong></div><span className="tag">Virtual money only</span></header>
  <div className="workspace">
   <aside className="sidebar">
    <div className="sidebar-title"><h2>Experiments</h2><button className="add-button" aria-label="New experiment" onClick={()=>setCreating(true)}>+</button></div>
    {experiments.length===0?<p className="sidebar-empty">Your experiments will appear here.</p>:<nav aria-label="Experiments">{experiments.map(e=><button key={e.id} className={"experiment-link "+(selected===e.id&&!creating?"active":"")} onClick={()=>{setCreating(false);setSelected(e.id);setError("");}}><strong>{e.name}</strong><span>{e.mode==="replay"?"Replay":"Paper trading"} · {e.currency}</span><b>{cash(e.totalEquity,e.currency)}</b></button>)}</nav>}
    <div className="sidebar-foot"><p>Buy on a rebound.<br/>Sell on a pullback.</p><small>Test the idea. Count the costs.</small></div>
   </aside>
   <main>
    {error&&<div className="error-banner" role="alert"><span>{error}</span><button className="quiet" onClick={()=>setError("")}>Dismiss</button></div>}
    {creating?<NewExperiment providers={providers} busy={busy} onCancel={()=>setCreating(false)} onCreate={input=>void run(()=>api(input.mode==="replay"?"/api/replays":"/api/experiments",input))}/>
    :!selected?<section className="welcome"><span className="welcome-line" aria-hidden="true">▁▂▅▃▆▇▅▃▂▄</span><h1>A place to test the next trade.</h1><p>Follow prices with simple rules, keep each trading budget separate, and see what remains after every fee.</p><button onClick={()=>setCreating(true)}>Create your first experiment</button><p className="hint">Start with synthetic data or a CSV. A market-data key is optional.</p></section>
    :!current?<div className="loading" role="status">Loading experiment…</div>:<>
     <div className="page-heading"><div><div className="eyebrow"><span className={"status-dot "+(connection==="Connected"?"online":"")}/>{current.mode==="replay"?"Historical replay":connection} <span className="tag">{providers.find(p=>p.id===current.provider)?.name??current.provider}</span></div><h1>{current.name}</h1></div><button className="secondary" onClick={()=>void exportExperiment()}>Export result</button></div>
     {current.provider==="demo"&&<div className="source-note synthetic">Synthetic prices. These results demonstrate the algorithm and are not historical stock returns.</div>}
     <section className="metrics" aria-label="Portfolio totals">
      <div><span>Total equity</span><strong>{cash(current.totalEquity,currency)}</strong><small>After estimated exit costs</small></div>
      <div><span>Net result</span><strong className={Number(current.netPnl)>=0?"positive":"negative"}>{cash(current.netPnl,currency)}</strong><small>Against {cash(current.deposits,currency)} deposited</small></div>
      <div><span>Main wallet</span><strong>{cash(current.balance,currency)}</strong><small>{cash(current.totalSwept,currency)} profit withdrawn</small></div>
      <div><span>Paid commissions</span><strong>{cash(current.totalFees,currency)}</strong><small>Both buy and sell transactions</small></div>
     </section>
     {current.mode==="paper"&&<details className="wallet-controls"><summary>Add virtual money to wallet</summary><form className="inline" onSubmit={e=>{e.preventDefault();mutate({action:"deposit",amount:depositAmount});}}><input aria-label="Deposit amount" type="number" min="0.01" step="0.01" value={depositAmount} onChange={e=>setDeposit(e.target.value)}/><button disabled={busy}>Add funds</button></form></details>}
     {current.pools.length>0&&<div className="pool-tabs" aria-label="Trading pools">{current.pools.map(p=><button key={p.id} className={pool?.id===p.id?"selected":""} onClick={()=>{setPoolId(p.id);setEditConfig(null);}}><strong>{p.instrument.symbol}</strong><span>{p.status==="paused"?"Paused":p.position?"Holding":"Waiting to buy"}</span></button>)}</div>}
     <Chart experiment={current} pool={pool}/>
     {pool&&<section className="pool-detail">
      <div className="section-title"><div><h2>{pool.instrument.name}</h2><p>{pool.instrument.exchange} · {pool.instrument.currency} · {(pool.status==="paused"?"Paused · ":"")+(pool.position?"Holding "+number(pool.position.quantity,8)+" shares":"Watching for a rebound")}{pool.pending?" · "+pool.pending+" queued for next observation":""}</p></div>
       {current.mode==="paper"&&<button className="secondary" disabled={busy} onClick={()=>mutate({action:pool.status==="paused"?"resume":"pause",poolId:pool.id})}>{pool.status==="paused"?"Resume":"Pause"}</button>}
      </div>
      {pool.notice&&<p className="notice" role="status">{pool.notice}</p>}
      <dl className="pool-numbers">
       <div><dt>Available cash</dt><dd>{cash(pool.cash,currency)}</dd></div><div><dt>Pending top-up</dt><dd>{cash(pool.pendingCash,currency)}</dd></div>
       <div><dt>Realized result</dt><dd className={Number(pool.realized)>=0?"positive":"negative"}>{cash(pool.realized,currency)}</dd></div>
       <div><dt>Profit to wallet</dt><dd>{cash(pool.swept,currency)}</dd></div>
       <div><dt>{pool.position?"Trailing high":"Running low"}</dt><dd>{pool.position?cash(pool.position.high,currency):pool.low?cash(pool.low,currency):"—"}</dd></div>
      </dl>
      {pool.position&&<dl className="pool-numbers">
       <div><dt>Entry cost with fee</dt><dd>{cash(pool.position.cost,currency)}</dd></div>
       <div><dt>Position market value</dt><dd>{cash(pool.positionValue,currency)}</dd></div>
       <div><dt>After exit costs</dt><dd>{cash(pool.netPositionValue,currency)}</dd></div>
       <div><dt>Unrealized result</dt><dd className={Number(pool.unrealized)>=0?"positive":"negative"}>{cash(pool.unrealized,currency)}</dd></div>
      </dl>}
      <p className="rule">Buy after <b>{pool.config.entryPct}%</b> rise from the running low. Sell after <b>{pool.config.exitPct}%</b> fall from the high. Fee: {cash(pool.config.fixedFee,currency)} + {pool.config.feePct}% per transaction. Slippage: {pool.config.slippagePct}% per fill.</p>
      {current.mode==="paper"&&<div className="pool-actions">
       <form className="inline" onSubmit={e=>{e.preventDefault();mutate({action:"topup",poolId:pool.id,amount:topupAmount});}}><Field label="Transfer from wallet"><input type="number" min="0.01" step="0.01" value={topupAmount} onChange={e=>setTopup(e.target.value)}/></Field><button className="secondary" disabled={busy}>Top up pool</button></form>
       <p className="hint">{pool.position?"This money waits for the next purchase; it does not increase the current position.":"Added cash is used when the next buy signal executes."}</p>
       {!pool.position&&!pool.pending&&<button className="quiet" onClick={()=>setEditConfig(editConfig?null:pool.config)}>Edit strategy</button>}
      </div>}
      {editConfig&&!pool.position&&!pool.pending&&<form onSubmit={e=>{e.preventDefault();mutate({action:"configure",poolId:pool.id,config:editConfig});setEditConfig(null);}}><StrategyFields value={editConfig} onChange={setEditConfig}/><button disabled={busy}>Save strategy</button></form>}
     </section>}
     {current.mode==="paper"&&<AddPool key={current.id} experiment={current} busy={busy} onAdd={input=>void run(()=>api("/api/experiments/"+current.id+"/pools",input))}/>}
     {current.replay&&<section className="replay-result"><div className="section-title"><h2>Replay comparison</h2><span>{current.replay.interval} observations</span></div><div className="comparison">
       <div><span>Strategy equity</span><strong>{cash(current.totalEquity,currency)}</strong></div><div><span>Buy and hold equity</span><strong>{cash(current.replay.benchmark,currency)}</strong></div><div><span>Maximum drawdown</span><strong>{number(current.replay.maxDrawdown,2)}%</strong></div><div><span>Observed gaps</span><strong>{current.replay.gaps}</strong></div>
      </div><p className="hint">{date(current.replay.from)} to {date(current.replay.to)} · {current.replay.samples} observations · {current.replay.adjustment} prices</p><details><summary>How to read this result</summary><ul>{current.replay.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul><p>Compare several instruments and periods. Frequent reversals can lose money even with profit withdrawals.</p></details></section>}
     <section className="ledger"><div className="section-title"><div><h2>Activity ledger</h2><p>Every allocation, execution, fee and profit transfer.</p></div><span>{current.ledger.length} entries</span></div><div className="table-scroll"><table><thead><tr><th>Time</th><th>Action</th><th>Instrument</th><th className="numeric">Amount</th><th className="numeric">Price</th><th className="numeric">Fee</th><th className="numeric">Net P&amp;L</th></tr></thead><tbody>
      {current.ledger.slice(-200).reverse().map(row=><tr key={row.id} title={row.note}><td>{date(row.time)}</td><td><span className={"action "+row.type}>{row.type}</span></td><td>{current.pools.find(p=>p.id===row.poolId)?.instrument.symbol??"Wallet"}</td><td className="numeric">{cash(row.amount,currency)}</td><td className="numeric">{row.price?cash(row.price,currency):"—"}</td><td className="numeric">{row.fee!==undefined?cash(row.fee,currency):"—"}</td><td className={"numeric "+(Number(row.pnl)>=0?"positive":"negative")}>{row.pnl!==undefined?cash(row.pnl,currency):"—"}</td></tr>)}
     </tbody></table></div>{current.ledger.length>200&&<p className="hint">Showing the last 200 entries. Export includes the full ledger.</p>}</section>
    </>}
   </main>
  </div>
 </div>;
}
createRoot(document.getElementById("root")!).render(<><HostLaunchBridge/><AppIdentityBridge><App/></AppIdentityBridge></>);
