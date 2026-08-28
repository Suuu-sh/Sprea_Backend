import {env} from "cloudflare:test";
import {beforeAll,describe,expect,it} from "vitest";
import {D1BuybackQuoteRepository} from "../src/infrastructure/d1-buyback-quote-repository";
import {createBuybackQuoteOpportunities,ingestListings} from "../src/pipeline";
import type {BuybackQuote} from "../src/domain";
import initial from "../migrations/0001_init.sql?raw";
import research from "../migrations/0002_research_api.sql?raw";
import safety from "../migrations/0003_research_safety.sql?raw";
import buyback from "../migrations/0004_buyback_quotes.sql?raw";
import buybackOpportunity from "../migrations/0005_buyback_opportunities.sql?raw";
function statements(migration:string){const out:string[]=[],lines=migration.split("\n");let buffer="",trigger=false;for(const line of lines){if(!trigger&&/^CREATE TRIGGER/i.test(line.trim()))trigger=true;buffer+=line+"\n";if(trigger){if(/^END;\s*$/i.test(line.trim())){out.push(buffer.trim().replace(/;$/,""));buffer="";trigger=false;}}else if(line.includes(";")){const parts=buffer.split(";");for(const part of parts.slice(0,-1))if(part.trim())out.push(part.trim());buffer=parts.at(-1)??"";}}if(buffer.trim())out.push(buffer.trim());return out;}
beforeAll(async()=>{for(const migration of [initial,research,safety,buyback,buybackOpportunity])for(const sql of statements(migration))await env.DB.prepare(sql).run();});
const at=new Date("2026-08-29T12:00:00Z");
async function purchase(externalId:string,model:string){await ingestListings(env.DB,[{source:"real-retailer",externalId,side:"purchase",title:model,brand:"Maker",model,manufacturerPartNumber:model,priceYen:100000,shippingYen:0,rewardYen:0,stock:1,condition:"new",capturedAt:at.toISOString()}],at);return String((await env.DB.prepare("SELECT id FROM canonical_products WHERE manufacturer_part_number=?").bind(model.replace(/[-_\s]/g,"")).first<any>())?.id??(await env.DB.prepare("SELECT id FROM canonical_products WHERE model=?").bind(model).first<any>())!.id);}
const buybackQuote=(id:string,productId:string,price:number):BuybackQuote=>({id,productId,provider:`provider-${id}`,sourceType:"manual",externalId:id,productName:"Item",condition:"new",attributes:{},price,shippingFee:0,fee:0,buybackStatus:"accepting",fetchedAt:at.toISOString(),lastSeenAt:at.toISOString(),matchConfidence:.97,matchReason:"model_attributes"});

describe("buyback quote opportunity connection",()=>{
 it("does not generate an opportunity without a buyback quote",async()=>{const productId=await purchase("without","NO-QUOTE");expect((await createBuybackQuoteOpportunities(env.DB,[productId],at)).created).toBe(0);});
 it("generates BUY from a real retail listing and eligible imported quote",async()=>{const productId=await purchase("buy","WITH-BUY");await new D1BuybackQuoteRepository(env.DB).upsertLatest(buybackQuote("buy",productId,106000));expect((await createBuybackQuoteOpportunities(env.DB,[productId],at)).created).toBe(1);const row=await env.DB.prepare("SELECT market_profit_yen,decision,resolver_confidence FROM research_opportunities WHERE canonical_product_id=? ORDER BY id DESC LIMIT 1").bind(productId).first<any>();expect(row).toMatchObject({market_profit_yen:6000,decision:"BUY",resolver_confidence:.97});});
 it("records SKIP below the 5,000 yen threshold",async()=>{const productId=await purchase("skip","WITH-SKIP");await new D1BuybackQuoteRepository(env.DB).upsertLatest(buybackQuote("skip",productId,104999));await createBuybackQuoteOpportunities(env.DB,[productId],at);const row=await env.DB.prepare("SELECT market_profit_yen,decision FROM research_opportunities WHERE canonical_product_id=? ORDER BY id DESC LIMIT 1").bind(productId).first<any>();expect(row).toMatchObject({market_profit_yen:4999,decision:"SKIP"});});
});
