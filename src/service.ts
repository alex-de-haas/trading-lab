import { randomUUID } from "node:crypto";
import type { Experiment, Pool, Interval } from "./model.js";
import { intervalMs } from "./model.js";
import { addPool, buyAndHold, D, decimal, deposit, equity, InputError, liquidation, log, markEquity, maxDrawdown, money, pause, processObservation, resume, strategy, topup } from "./engine.js";
import { Store } from "./store.js";
import { createProviders } from "./providers/index.js";
import { checkedRange, ProviderError } from "./providers/types.js";
import { parseCsv } from "./providers/csv.js";
export function label(value:unknown,name:string,max=120):string{
  if(typeof value!=="string" || !value.trim() || value.length>max || /[\u0000-\u001f]/.test(value))throw new InputError(`Invalid ${name}.`);return value.trim();
}
export function newExperiment(input:any):Experiment {
  if(!["USD","EUR"].includes(input.currency))throw new InputError("Choose USD or EUR.");
  if(!["paper","replay"].includes(input.mode))throw new InputError("Choose paper trading or replay.");
  return {id:randomUUID(),name:label(input.name,"experiment name"),currency:input.currency,provider:label(input.provider,"provider"),mode:input.mode,createdAt:new Date().toISOString(),balance:"0",deposits:"0",pools:[],ledger:[],revision:0,equity:[]};
}
export function present(e:Experiment){
  return {...e,pools:e.pools.map(p=>({...p,
    positionValue:p.position&&p.last?money(D(p.position.quantity).mul(p.last.price)):"0",
    netPositionValue:money(liquidation(p)),
    unrealized:p.position?money(liquidation(p).minus(p.position.cost)):"0",
  })),totalEquity:equity(e),netPnl:money(D(equity(e)).minus(e.deposits)),totalFees:money(e.pools.reduce((n,p)=>n.plus(p.fees),D(0))),totalSwept:money(e.pools.reduce((n,p)=>n.plus(p.swept),D(0)))};
}
export class TradingService {
  readonly providers;
  private subscribers=new Map<string,Set<(e:Experiment)=>void>>();
  private due=new Map<string,number>();
  private busy=false;
  constructor(readonly store:Store) {this.providers=createProviders(store);}
  subscribe(owner:string,id:string,listener:(e:Experiment)=>void) {
    this.store.get(owner,id);
    const key=JSON.stringify([owner,id]),set=this.subscribers.get(key)??new Set();set.add(listener);this.subscribers.set(key,set);
    return ()=>{set.delete(listener);if(!set.size)this.subscribers.delete(key);};
  }
  private publish(owner:string,e:Experiment){for(const f of this.subscribers.get(JSON.stringify([owner,e.id]))??[])f(e);}
  private update(owner:string,id:string,fn:(e:Experiment)=>void){const e=this.store.update(owner,id,fn);this.publish(owner,e);return present(e);}
  list(owner:string){return this.store.list(owner).map(e=>({id:e.id,name:e.name,currency:e.currency,provider:e.provider,mode:e.mode,totalEquity:equity(e)}));}
  create(owner:string,input:any){
    const e=newExperiment({...input,mode:"paper"}),p=this.providers.get(e.provider);
    if(!p.info.live)throw new InputError("This provider supports replay only.");
    if(!p.info.configured)throw new InputError("Configure the provider before starting paper trading.");
    deposit(e,input.initialFunds);this.store.create(owner,e);return present(e);
  }
  async addPool(owner:string,id:string,input:any) {
    const before=this.store.get(owner,id);
    const instrument=await this.providers.get(before.provider).resolve(label(input.instrumentId,"instrument",300),owner);
    return this.update(owner,id,e=>{
      if(e.mode!=="paper")throw new InputError("A completed replay cannot be edited. Create another replay.");
      addPool(e,instrument,strategy(input.config),input.amount,randomUUID());
    });
  }
  mutate(owner:string,id:string,input:any){
    return this.update(owner,id,e=>{
      if(e.mode!=="paper")throw new InputError("Replays are immutable. Create another replay.");
      if(input.action==="deposit"){deposit(e,input.amount);return;}
      const p=e.pools.find(p=>p.id===input.poolId);if(!p)throw new InputError("Pool not found.");
      if(input.action==="topup")topup(e,p,input.amount);
      else if(input.action==="pause")pause(e,p);
      else if(input.action==="resume")resume(e,p);
      else if(input.action==="configure"){
        if(p.position || p.pending)throw new InputError("Change settings while the pool is flat with no pending order.");
        p.config=strategy(input.config);p.low=null;
      }else throw new InputError("Unknown action.");
    });
  }
  importCsv(owner:string,input:any){
    if(!["USD","EUR"].includes(input.currency))throw new InputError("Choose a supported currency.");
    if(!["1min","5min","1day"].includes(input.interval))throw new InputError("Choose a supported interval.");
    if(!["raw","split-adjusted"].includes(input.adjustment))throw new InputError("Declare the price adjustment basis.");
    const id=randomUUID(),symbol=label(input.symbol,"symbol",24),exchange=label(input.exchange,"exchange",60);
    const instrument={id:`csv:${id}`,provider:"csv",symbol,name:label(input.name,"dataset name"),exchange,currency:input.currency,dataset:id};
    if(typeof input.csv!=="string")throw new InputError("CSV text is required.");
    const data=parseCsv(input.csv,instrument,input.interval,input.adjustment);
    this.store.import({id,owner,name:instrument.name,instrument,interval:input.interval,...data});
    return {instrument,interval:input.interval,from:data.observations[0].timestamp,to:data.observations.at(-1)!.timestamp,samples:data.observations.length};
  }
  async replay(owner:string,input:any){
    const e=newExperiment({...input,mode:"replay"}),provider=this.providers.get(e.provider);
    const range={from:input.from,to:input.to,interval:input.interval as Interval};checkedRange(range);
    if(!provider.info.history)throw new InputError("This provider has no historical data.");
    const instrument=await provider.resolve(label(input.instrumentId,"instrument",300),owner);
    const data=await provider.history(instrument,range,owner);
    if(data.observations.length<2)throw new InputError("At least two observations are required in this date range.");
    deposit(e,input.initialFunds,range.from);
    const p=addPool(e,instrument,strategy(input.config),input.amount,randomUUID(),range.from);
    const initialCash=e.balance;
    markEquity(e,range.from);
    let gaps=0,last=0;
    for(const obs of data.observations){
      const t=Date.parse(obs.timestamp);
      if(last && t-last>intervalMs[range.interval]*1.5)gaps++;
      last=t;
      processObservation(e,p,obs);markEquity(e,obs.timestamp);
    }
    const benchmark=money(D(initialCash).plus(buyAndHold(p.allocated,data.observations[0].price,data.observations.at(-1)!.price,p.config)));
    e.replay={...range,samples:data.observations.length,gaps,benchmark,maxDrawdown:maxDrawdown(e.equity),adjustment:data.observations[0].adjustment,warnings:[...data.warnings,"Signals execute at the next observation. Open positions remain marked to market; equity includes estimated exit costs.","Gaps include exchange closures and are not necessarily missing vendor data."]};
    if(p.status==="paused")e.replay.warnings.push(p.notice);
    this.store.create(owner,e);return present(e);
  }
  recover(){
    for(const {owner,state} of this.store.allPaper()){
      if(!state.pools.some(p=>p.status==="running"))continue;
      this.update(owner,state.id,e=>{
        for(const p of e.pools.filter(p=>p.status==="running")){
          p.pending=null;p.resumeAfter=new Date().toISOString();
          p.notice="Collection restarted. No orders were filled during downtime.";
          log(e,{time:new Date().toISOString(),type:"gap",poolId:p.id,amount:"0",note:p.notice});
        }
      });
    }
  }
  async tick(now=Date.now()){
    if(this.busy)return;
    this.busy=true;
    try{
      const groups=new Map<string,{pool:Pool,targets:Array<{owner:string,id:string,poolId:string}>}>();
      for(const {owner,state} of this.store.allPaper())for(const p of state.pools){
        const key=p.instrument.id;
        if(p.status==="paused" && !p.position)continue;
        const group=groups.get(key)??{pool:p,targets:[]};group.targets.push({owner,id:state.id,poolId:p.id});groups.set(key,group);
      }
      for(const [key,g] of groups){
        const provider=this.providers.get(g.pool.instrument.provider);
        if((this.due.get(key)??0)>now)continue;
        this.due.set(key,now+provider.info.pollSeconds*1000);
        if(provider.info.id==="twelve"&&!usMarketWindow(now))continue;
        try{
          const obs=await provider.latest(g.pool.instrument);
          for(const target of g.targets)this.update(target.owner,target.id,e=>{
            const p=e.pools.find(p=>p.id===target.poolId)!;
            if(!obs){p.notice="No fresh completed bar. The exchange may be closed or the feed delayed.";return;}
            const changed=processObservation(e,p,obs,now);
            if(changed){
              if(p.status==="running")p.notice="";
              markEquity(e,obs.timestamp);
            }else if(!p.notice)p.notice="Waiting for a fresh market observation.";
          });
        }catch(error){
          const message=error instanceof ProviderError || error instanceof InputError ? error.message:"Collection failed. Retry is scheduled.";
          for(const target of g.targets)this.update(target.owner,target.id,e=>{e.pools.find(p=>p.id===target.poolId)!.notice=message;});
        }
      }
    }finally{this.busy=false;}
  }
}
export function usMarketWindow(now:number){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const minute=Number(parts.hour)*60+Number(parts.minute);
  return !["Sat","Sun"].includes(parts.weekday)&&minute>=570&&minute<=975;
}
