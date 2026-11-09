import type { Store } from "../store.js";
import { demoProvider } from "./demo.js";
import { csvProvider } from "./csv.js";
import { twelveProvider } from "./twelve.js";
import { ProviderError, type MarketDataProvider } from "./types.js";
export function createProviders(store:Store) {
  const adapters:MarketDataProvider[]=[demoProvider,csvProvider(owner=>store.datasets(owner),(owner,id)=>store.dataset(owner,id)),twelveProvider(process.env.TWELVE_DATA_API_KEY,()=>store.reserveTwelve())];
  const registry=new Map(adapters.map(adapter=>[adapter.info.id,adapter]));
  return { list:()=>adapters.map(a=>a.info), get:(id:string)=>{const p=registry.get(id);if(!p)throw new ProviderError("Unknown data provider.");return p;} };
}
