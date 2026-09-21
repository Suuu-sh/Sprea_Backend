import {env} from "cloudflare:test";
import {beforeAll,describe,expect,it,vi} from "vitest";
import initial from "../migrations/0001_init.sql?raw";
import research from "../migrations/0002_research_api.sql?raw";
import safety from "../migrations/0003_research_safety.sql?raw";
import buyback from "../migrations/0004_buyback_quotes.sql?raw";
import buybackOpportunity from "../migrations/0005_buyback_opportunities.sql?raw";
import liveOpportunities from "../migrations/0006_live_opportunities.sql?raw";
import evaluationScores from "../migrations/0007_evaluation_scores.sql?raw";
import decisionObservability from "../migrations/0008_decision_observability.sql?raw";
import productDiscovery from "../migrations/0009_product_discovery.sql?raw";
import providerDiscovery from "../migrations/0010_provider_discovery.sql?raw";
import buybackDailyStats from "../migrations/0012_buyback_daily_stats.sql?raw";
import discoveryReadOptimization from "../migrations/0013_discovery_read_optimization.sql?raw";
import materializedDiscoveryQueue from "../migrations/0014_materialized_discovery_queue.sql?raw";
import csvRetentionCleanup from "../migrations/0015_csv_retention_cleanup.sql?raw";
import {buildDiscoveryCandidates,markDiscoveryQueueDirty,runProductDiscovery} from "../src/discovery";

function statements(migration:string){const out:string[]=[],lines=migration.split("\n");let buffer="",trigger=false;for(const line of lines){if(!trigger&&/^CREATE TRIGGER/i.test(line.trim()))trigger=true;buffer+=line+"\n";if(trigger){if(/^END;\s*$/i.test(line.trim())){out.push(buffer.trim().replace(/;$/,""));buffer="";trigger=false;}}else if(line.includes(";")){const parts=buffer.split(";");for(const part of parts.slice(0,-1))if(part.trim())out.push(part.trim());buffer=parts.at(-1)??"";}}if(buffer.trim())out.push(buffer.trim());return out;}
beforeAll(async()=>{for(const migration of [initial,research,safety,buyback,buybackOpportunity,liveOpportunities,evaluationScores,decisionObservability,productDiscovery,providerDiscovery,buybackDailyStats,discoveryReadOptimization,materializedDiscoveryQueue,csvRetentionCleanup])for(const sql of statements(migration))await env.DB.prepare(sql).run();});


import {budgetDatabase,budgetStatus,BudgetPause,DAILY_BUDGET} from "../src/d1-budget";
import {importKaitorixCsvCandidates} from "../src/application/import-kaitorix-csv-candidates";
const key="operations/d1-budget-v1.json";
const today=()=>new Date().toISOString().slice(0,10);
const candidate=(i:number)=>({jan:`490${String(i).padStart(10,"0")}`,productName:`新品 Budget Device ${i}`,category:"other" as const,condition:"new" as const,msrp:30000,bestBuybackPrice:20000,bestBuybackProvider:"budget-store",storeCount:1,stores:[{provider:"budget-store",price:20000,fetchedAt:new Date().toISOString()}]});
describe("D1 safety budget",()=>{
 it("reserves before a write, stops before quota, and resets at UTC midnight",async()=>{
  await env.MODELS.put(key,JSON.stringify({day:today(),reads:0,writes:59900}));
  const db=budgetDatabase(env.DB,env.MODELS);
  await expect(db.prepare("UPDATE research_settings SET fees_yen=1 WHERE id=1").run()).rejects.toBeInstanceOf(BudgetPause);
  expect((await env.DB.prepare("SELECT fees_yen FROM research_settings WHERE id=1").first<any>()).fees_yen).toBe(0);
  await env.MODELS.put(key,JSON.stringify({day:"2000-01-01",reads:0,writes:60000}));
  await db.prepare("UPDATE research_settings SET fees_yen=1 WHERE id=1").run();
  expect((await budgetStatus(env.MODELS)).writes).toBeLessThan(128);
 });
 it("reserves concurrently without letting both writers spend the remaining budget",async()=>{
  await env.MODELS.put(key,JSON.stringify({day:today(),reads:0,writes:59999}));
  const db=budgetDatabase(env.DB,env.MODELS);
  const results=await Promise.allSettled([1,2,3].map(n=>db.prepare("UPDATE research_settings SET fees_yen=? WHERE id=1").bind(n).run()));
  expect(results.every(x=>x.status==="rejected")).toBe(true);
  expect((await budgetStatus(env.MODELS)).writes).toBe(59999);
 });
 it("leaves unknown failed work reserved and denies cascading deletes",async()=>{
  await env.MODELS.delete(key);const db=budgetDatabase(env.DB,env.MODELS);
  await expect(db.prepare("SELECT * FROM missing_table").all()).rejects.toThrow();
  expect((await budgetStatus(env.MODELS)).reads).toBe(250000);
  await expect(db.prepare("DELETE FROM product_discovery_candidates").run()).rejects.toBeInstanceOf(BudgetPause);
 });
 it("reimporting identical CSV rows spends zero additional row writes",async()=>{
  await env.MODELS.delete(key);const db=budgetDatabase(env.DB,env.MODELS),items=Array.from({length:100},(_,i)=>candidate(i));
  await importKaitorixCsvCandidates(db,today(),items);
  const before=await budgetStatus(env.MODELS);
  await importKaitorixCsvCandidates(db,today(),items);
  expect((await budgetStatus(env.MODELS)).writes).toBe(before.writes);
 });
 it("keeps candidates and IDs on repeated snapshot rebuilds",async()=>{
  const at=new Date(),items=[candidate(90000)];
  await importKaitorixCsvCandidates(env.DB,today(),items);
  await buildDiscoveryCandidates(env.DB,at);
  const before=await env.DB.prepare("SELECT id FROM product_discovery_candidates WHERE jan=?").bind(items[0].jan).first<any>();
  await buildDiscoveryCandidates(env.DB,new Date(at.getTime()+60000));
  expect(await env.DB.prepare("SELECT id FROM product_discovery_candidates WHERE jan=?").bind(items[0].jan).first()).toEqual(before);
 });
 it("measures a steady-state day including CSV refresh and up to 288 cron ticks",async()=>{
  vi.useFakeTimers();const at=new Date("2045-01-01T00:10:00Z");vi.setSystemTime(at);
  await env.MODELS.delete(key);const db=budgetDatabase(env.DB,env.MODELS);let paused=false;
  vi.stubGlobal("fetch",async()=>new Response(JSON.stringify({hits:[],items:[]})));
  try{
   // Bootstrap outside the measured day, matching the already-populated production DB.
   for(let i=0;i<5000;i+=500)await importKaitorixCsvCandidates(env.DB,"2045-01-01",Array.from({length:500},(_,j)=>candidate(100000+i+j)));
   await buildDiscoveryCandidates(env.DB,at);
   await env.DB.prepare("INSERT INTO product_discovery_provider_state(candidate_id,provider,next_search_at,queue_priority_yen) SELECT id,'yahoo',?,best_buyback_price_yen FROM product_discovery_candidates").bind(at.toISOString()).run();
   await env.DB.prepare("INSERT INTO product_discovery_provider_state(candidate_id,provider,next_search_at,queue_priority_yen) SELECT id,'rakuten',?,best_buyback_price_yen FROM product_discovery_candidates").bind(at.toISOString()).run();
   at.setUTCDate(2);at.setUTCMinutes(0);vi.setSystemTime(at);
   for(let i=0;i<5000;i+=500)await importKaitorixCsvCandidates(budgetDatabase(env.DB,env.MODELS),"2045-01-02",Array.from({length:500},(_,j)=>candidate(100000+i+j)));
   await markDiscoveryQueueDirty(db,false,at);
   for(let tick=0;tick<288;tick++){
    const time=new Date(at.getTime()+tick*300000);vi.setSystemTime(time);
    const pending=runProductDiscovery({DB:budgetDatabase(env.DB,env.MODELS),YAHOO_CLIENT_ID:"test",RAKUTEN_APPLICATION_ID:"test",RAKUTEN_ACCESS_KEY:"test"},"scheduled",30,time);
    const outcome=pending.then(value=>({value,error:null as unknown}),error=>({value:null,error}));
    await vi.runAllTimersAsync();const finished=await outcome;if(finished.error)throw finished.error;
   }
  }catch(error){expect(error).toBeInstanceOf(BudgetPause);paused=true;}
  finally{vi.useRealTimers();vi.unstubAllGlobals();}
  const object=await env.MODELS.get(key),ledger=await object!.json<{reads:number;writes:number}>();
  console.info("5000-item steady-state daily budget measurement",{...ledger,paused});
  expect(paused).toBe(false);
  expect(ledger.reads).toBeLessThanOrEqual(DAILY_BUDGET.reads);
  expect(ledger.writes).toBeLessThanOrEqual(DAILY_BUDGET.writes);
 },120000);
 it("runs 5000-item import, queue creation and 288 cron ticks within the safety budget or pauses",async()=>{
  vi.useFakeTimers();const at=new Date("2045-01-01T00:10:00Z");vi.setSystemTime(at);
  await env.MODELS.delete(key);const db=budgetDatabase(env.DB,env.MODELS);let paused=false;
  vi.stubGlobal("fetch",async()=>new Response(JSON.stringify({hits:[],items:[]})));
  try{
   for(let i=0;i<5000;i+=500)await importKaitorixCsvCandidates(budgetDatabase(env.DB,env.MODELS),"2045-01-01",Array.from({length:500},(_,j)=>candidate(100000+i+j)));
   await markDiscoveryQueueDirty(db,false,at);
   for(let tick=0;tick<288;tick++){
    const time=new Date(at.getTime()+tick*300000);vi.setSystemTime(time);
    const pending=runProductDiscovery({DB:budgetDatabase(env.DB,env.MODELS),YAHOO_CLIENT_ID:"test",RAKUTEN_APPLICATION_ID:"test",RAKUTEN_ACCESS_KEY:"test"},"scheduled",30,time);
    const outcome=pending.then(value=>({value,error:null as unknown}),error=>({value:null,error}));
    await vi.runAllTimersAsync();const finished=await outcome;if(finished.error)throw finished.error;
   }
  }catch(error){expect(error).toBeInstanceOf(BudgetPause);paused=true;}
  finally{vi.useRealTimers();vi.unstubAllGlobals();}
  const object=await env.MODELS.get(key),ledger=await object!.json<{reads:number;writes:number}>();
  console.info("5000-item daily budget measurement",{...ledger,paused});
  expect(ledger.reads).toBeLessThanOrEqual(DAILY_BUDGET.reads);
  expect(ledger.writes).toBeLessThanOrEqual(DAILY_BUDGET.writes);
 },120000);
});
