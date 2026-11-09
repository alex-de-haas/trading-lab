import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Experiment } from "./model.js";
import type { ImportedData } from "./providers/csv.js";
import { InputError } from "./engine.js";
import { ProviderError } from "./providers/types.js";
function readExperiment(json:string):Experiment {
  const state=JSON.parse(json) as Experiment;
  if(state.pools.some(p=>p.unresolvedData===undefined)) {
    // Earlier versions used a mutable notice as the resume guard. The ledger
    // preserves a detection even if a later pause or provider error hid it.
    const dataIssue=/discontinuity|corporate action|adjustment basis/i;
    const blocked=new Set(state.ledger.filter(row=>row.type==="pause"&&dataIssue.test(row.note)).map(row=>row.poolId));
    for(const p of state.pools)if(p.unresolvedData===undefined)p.unresolvedData=blocked.has(p.id)||dataIssue.test(p.notice);
  }
  for(const p of state.pools)if(p.unresolvedData){p.status="paused";p.pending=null;}
  return state;
}
export class Store {
  private db:DatabaseSync;
  constructor(path:string) {
    if(path!==":memory:") mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS budgets(key TEXT PRIMARY KEY, count INTEGER NOT NULL);");
  }
  list(owner:string):Experiment[]{return this.db.prepare("SELECT state FROM experiments WHERE owner=? ORDER BY rowid DESC").all(owner).map(r=>readExperiment(String(r.state)));}
  allPaper():Array<{owner:string;state:Experiment}>{return this.db.prepare("SELECT owner,state FROM experiments").all().map(r=>({owner:String(r.owner),state:readExperiment(String(r.state))})).filter(r=>r.state.mode==="paper");}
  get(owner:string,id:string):Experiment {
    const row=this.db.prepare("SELECT state FROM experiments WHERE owner=? AND id=?").get(owner,id);
    if(!row) throw new InputError("Experiment not found.");
    return readExperiment(String(row.state));
  }
  create(owner:string,state:Experiment) {
    if(this.list(owner).length>=60) throw new InputError("Maximum 60 experiments per user.");
    this.db.prepare("INSERT INTO experiments VALUES(?,?,?)").run(state.id,owner,JSON.stringify(state));
  }
  update(owner:string,id:string,fn:(state:Experiment)=>void,expectedRevision?:number):Experiment {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state=this.get(owner,id),before=JSON.stringify(state.ledger);
      if(expectedRevision!==undefined && state.revision!==expectedRevision) throw new InputError("This experiment changed. Refresh before retrying.");
      const ledgerLength=state.ledger.length;
      fn(state);
      if(JSON.stringify(state.ledger.slice(0,ledgerLength))!==before) throw new Error("Ledger entries are immutable.");
      state.revision++;
      this.db.prepare("UPDATE experiments SET state=? WHERE owner=? AND id=?").run(JSON.stringify(state),owner,id);
      this.db.exec("COMMIT");return state;
    } catch(error) {this.db.exec("ROLLBACK");throw error;}
  }
  datasets(owner:string):ImportedData[]{return this.db.prepare("SELECT state FROM datasets WHERE owner=?").all(owner).map(r=>JSON.parse(String(r.state)));}
  dataset(owner:string,id:string):ImportedData|undefined {const row=this.db.prepare("SELECT state FROM datasets WHERE owner=? AND id=?").get(owner,id);return row?JSON.parse(String(row.state)):undefined;}
  import(data:ImportedData){if(this.datasets(data.owner).length>=40)throw new InputError("Maximum 40 imported datasets.");this.db.prepare("INSERT INTO datasets VALUES(?,?,?)").run(data.instrument.id,data.owner,JSON.stringify(data));}
  reserveTwelve(now=Date.now()){
    const day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for(const [key,limit] of [[`day:${day}`,750],[`minute:${minute}`,8]] as const){
        const count=Number(this.db.prepare("SELECT count FROM budgets WHERE key=?").get(key)?.count ?? 0);
        if(count>=limit)throw new ProviderError("Local market-data budget reached. Try again after the quota resets.");
        this.db.prepare("INSERT INTO budgets VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1").run(key);
      }
      this.db.prepare("DELETE FROM budgets WHERE key NOT IN (?,?)").run(`day:${day}`,`minute:${minute}`);
      this.db.exec("COMMIT");
    }catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  close(){this.db.close();}
}
