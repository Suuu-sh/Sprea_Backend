import {env} from "cloudflare:test";
import {beforeAll,describe,expect,it} from "vitest";
import {D1BuybackQuoteRepository} from "../src/infrastructure/d1-buyback-quote-repository";
import {createBuybackQuoteOpportunities,ingestListings} from "../src/pipeline";
import type {BuybackQuote} from "../src/domain";
import {buildDiscoveryCandidates} from "../src/discovery";
import initial from "../migrations/0001_init.sql?raw";
import research from "../migrations/0002_research_api.sql?raw";
import safety from "../migrations/0003_research_safety.sql?raw";
import buyback from "../migrations/0004_buyback_quotes.sql?raw";
import buybackOpportunity from "../migrations/0005_buyback_opportunities.sql?raw";
import liveOpportunities from "../migrations/0006_live_opportunities.sql?raw";
import evaluationScores from "../migrations/0007_evaluation_scores.sql?raw";
import decisionObservability from "../migrations/0008_decision_observability.sql?raw";
import productDiscovery from "../migrations/0009_product_discovery.sql?raw";
import buybackDailyStats from "../migrations/0012_buyback_daily_stats.sql?raw";
function statements(migration:string){const out:string[]=[],lines=migration.split("\n");let buffer="",trigger=false;for(const line of lines){if(!trigger&&/^CREATE TRIGGER/i.test(line.trim()))trigger=true;buffer+=line+"\n";if(trigger){if(/^END;\s*$/i.test(line.trim())){out.push(buffer.trim().replace(/;$/,""));buffer="";trigger=false;}}else if(line.includes(";")){const parts=buffer.split(";");for(const part of parts.slice(0,-1))if(part.trim())out.push(part.trim());buffer=parts.at(-1)??"";}}if(buffer.trim())out.push(buffer.trim());return out;}
beforeAll(async()=>{for(const migration of [initial,research,safety,buyback,buybackOpportunity,liveOpportunities,evaluationScores,decisionObservability,productDiscovery,buybackDailyStats])for(const sql of statements(migration))await env.DB.prepare(sql).run();});
const at=new Date("2026-08-29T12:00:00Z");
async function purchase(externalId:string,model:string){await ingestListings(env.DB,[{source:"real-retailer",externalId,side:"purchase",title:model,url:`https://example.test/${externalId}`,brand:"Maker",model,manufacturerPartNumber:model,priceYen:100000,shippingYen:0,rewardYen:0,stock:1,stockStatus:"in_stock",condition:"new",capturedAt:at.toISOString()}],at);return String((await env.DB.prepare("SELECT id FROM canonical_products WHERE manufacturer_part_number=?").bind(model.replace(/[-_\s]/g,"")).first<any>())?.id??(await env.DB.prepare("SELECT id FROM canonical_products WHERE model=?").bind(model).first<any>())!.id);}
const buybackQuote=(id:string,productId:string,price:number,overrides:Partial<BuybackQuote>={}):BuybackQuote=>({id,productId,provider:`provider-${id}`,sourceType:"manual",externalId:id,productName:"Item",condition:"new",attributes:{},price,shippingFee:0,fee:0,buybackStatus:"accepting",fetchedAt:at.toISOString(),lastSeenAt:at.toISOString(),matchConfidence:.97,matchReason:"model_attributes",...overrides});

describe("buyback quote opportunity connection",()=>{
 it("promotes a buyback-only JAN into a searchable canonical candidate",async()=>{const repository=new D1BuybackQuoteRepository(env.DB);await repository.upsertLatest(buybackQuote("discovery-a","",120000,{productId:undefined,provider:"one",jan:"4549995999999",productName:"Discovery Device 256GB",modelNumber:undefined}));await repository.upsertLatest(buybackQuote("discovery-b","",121000,{productId:undefined,provider:"two",jan:"4549995999999",productName:"Discovery Device 256GB",modelNumber:undefined}));const result=await buildDiscoveryCandidates(env.DB,at),candidate=await env.DB.prepare("SELECT * FROM product_discovery_candidates WHERE jan='4549995999999'").first<any>();expect(result.candidates).toBeGreaterThan(0);expect(candidate).toMatchObject({resolver_status:"searchable",resolver_confidence:1,best_buyback_price_yen:121000,buyback_provider_count:2,search_query:"4549995999999"});expect(candidate.canonical_product_id).toBeGreaterThan(0);});
 it("does not generate an opportunity without a buyback quote",async()=>{const productId=await purchase("without","NO-QUOTE");expect((await createBuybackQuoteOpportunities(env.DB,[productId],at)).created).toBe(0);});
 it("generates BUY from a real retail listing and eligible imported quote",async()=>{const productId=await purchase("buy","WITH-BUY");await new D1BuybackQuoteRepository(env.DB).upsertLatest(buybackQuote("buy",productId,106000));expect((await createBuybackQuoteOpportunities(env.DB,[productId],at)).created).toBe(1);const row=await env.DB.prepare("SELECT market_profit_yen,decision,resolver_confidence FROM research_opportunities WHERE canonical_product_id=? ORDER BY id DESC LIMIT 1").bind(productId).first<any>();expect(row).toMatchObject({market_profit_yen:6000,decision:"BUY",resolver_confidence:.97});});
 it("records SKIP below the 5,000 yen threshold",async()=>{const productId=await purchase("skip","WITH-SKIP");await new D1BuybackQuoteRepository(env.DB).upsertLatest(buybackQuote("skip",productId,104999));await createBuybackQuoteOpportunities(env.DB,[productId],at);const row=await env.DB.prepare("SELECT market_profit_yen,decision FROM research_opportunities WHERE canonical_product_id=? ORDER BY id DESC LIMIT 1").bind(productId).first<any>();expect(row).toMatchObject({market_profit_yen:4999,decision:"SKIP"});});
 it("selects the lowest effective retail cost, stores top three quotes, and opens a paper trade",async()=>{
  await ingestListings(env.DB,[
   {source:"yahoo-shopping",externalId:"multi-yahoo",side:"purchase",title:"MULTI",url:"https://example.test/yahoo",brand:"Maker",model:"MULTI",manufacturerPartNumber:"MULTI",priceYen:90000,shippingYen:0,rewardYen:0,stock:1,stockStatus:"in_stock",condition:"new",capturedAt:at.toISOString()},
   {source:"rakuten",externalId:"multi-rakuten",side:"purchase",title:"MULTI",url:"https://example.test/rakuten",brand:"Maker",model:"MULTI",manufacturerPartNumber:"MULTI",priceYen:88500,shippingYen:500,rewardYen:0,stock:1,stockStatus:"low_stock",condition:"new",capturedAt:at.toISOString()},
  ],at);
  const productId=String((await env.DB.prepare("SELECT id FROM canonical_products WHERE manufacturer_part_number='MULTI'").first<any>())!.id),repository=new D1BuybackQuoteRepository(env.DB);
  await repository.upsertLatest(buybackQuote("top-a",productId,100000,{provider:"one"}));
  await repository.upsertLatest(buybackQuote("top-b",productId,99000,{provider:"two"}));
  await repository.upsertLatest(buybackQuote("top-c",productId,98000,{provider:"three"}));
  const result=await createBuybackQuoteOpportunities(env.DB,[productId],at);
  expect(result).toMatchObject({created:1,buys:1});
  const row=await env.DB.prepare(`SELECT o.purchase_price_yen,o.purchase_shipping_yen,o.buy_cost_yen,o.market_profit_yen,o.decision,o.best_buyback_provider,o.buyback_price_yen,o.second_buyback_provider,o.second_buyback_price_yen,o.third_buyback_provider,o.third_buyback_price_yen,o.buyback_store_count,o.best_second_spread_yen,l.source purchase_source FROM research_opportunities o JOIN research_listings l ON l.id=o.purchase_listing_id WHERE o.canonical_product_id=? ORDER BY o.id DESC LIMIT 1`).bind(productId).first<any>();
  expect(row).toMatchObject({purchase_source:"rakuten",purchase_price_yen:88500,purchase_shipping_yen:500,buy_cost_yen:89000,market_profit_yen:11000,decision:"BUY",best_buyback_provider:"one",buyback_price_yen:100000,second_buyback_provider:"two",second_buyback_price_yen:99000,third_buyback_provider:"three",third_buyback_price_yen:98000,buyback_store_count:3,best_second_spread_yen:1000});
  expect((await env.DB.prepare("SELECT COUNT(*) count FROM research_paper_trades WHERE canonical_product_id=? AND status='OPEN'").bind(productId).first<any>())!.count).toBe(1);
 });
});
