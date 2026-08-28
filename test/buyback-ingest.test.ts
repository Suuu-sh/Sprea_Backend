import {env} from "cloudflare:test";
import {beforeAll, describe, expect, it} from "vitest";
import worker from "../src/index";
import initial from "../migrations/0001_init.sql?raw";
import research from "../migrations/0002_research_api.sql?raw";
import safety from "../migrations/0003_research_safety.sql?raw";
import buyback from "../migrations/0004_buyback_quotes.sql?raw";

function statements(migration:string){const out:string[]=[],lines=migration.split("\n");let buffer="",trigger=false;for(const line of lines){if(!trigger&&/^CREATE TRIGGER/i.test(line.trim()))trigger=true;buffer+=line+"\n";if(trigger){if(/^END;\s*$/i.test(line.trim())){out.push(buffer.trim().replace(/;$/,""));buffer="";trigger=false;}}else if(line.includes(";")){const parts=buffer.split(";");for(const part of parts.slice(0,-1))if(part.trim())out.push(part.trim());buffer=parts.at(-1)??"";}}if(buffer.trim())out.push(buffer.trim());return out;}
beforeAll(async()=>{for(const migration of [initial,research,safety,buyback])for(const sql of statements(migration))await env.DB.prepare(sql).run();});

const valid={externalId:"quote-1",productName:"Camera X",jan:"4901234567890",modelNumber:"CAM-X",condition:"new",price:100000,shippingFee:0,fee:0,buybackStatus:"accepting",fetchedAt:"2026-08-29T00:00:00Z"};
const request=(body:unknown,token?:string)=>worker.fetch!(new Request("http://test/api/ingest/buyback-quotes",{method:"POST",headers:{...(token?{authorization:`Bearer ${token}`}:{ }),"content-type":"application/json"},body:JSON.stringify(body)}),{...env,SPREA_INGEST_TOKEN:"secret",COLLECTOR_MODE:"disabled" as const} as Env);

describe("buyback quote ingest",()=>{
  it("requires the dedicated Bearer token",async()=>{expect((await request({provider:"manual",sourceType:"manual",quotes:[valid]})).status).toBe(401);expect((await request({provider:"manual",sourceType:"manual",quotes:[valid]},"wrong")).status).toBe(401);});
  it("validates per item, resolves JAN, and saves only valid quotes",async()=>{await env.DB.prepare("INSERT INTO canonical_products(canonical_key,gtin,manufacturer_part_number,brand,model,condition,title,created_at,updated_at) VALUES('camera','4901234567890','CAM-X','Maker','Camera X','new','Camera X',datetime('now'),datetime('now'))").run();const response=await request({provider:"manual",sourceType:"manual",quotes:[valid,{...valid,externalId:"bad",price:0}]},"secret");expect(response.status).toBe(202);const body=await response.json() as any;expect(body).toMatchObject({accepted:1,rejected:1});expect(body.results[0].match).toMatchObject({reason:"jan_exact",confidence:1});expect(body.results[1].errors).toContain("price must be a positive safe integer");const row=await env.DB.prepare("SELECT product_id,price FROM buyback_quotes WHERE provider='manual' AND external_id='quote-1'").first<any>();expect(row.product_id).not.toBeNull();expect(row.price).toBe(100000);});
  it("upserts provider/externalId while preserving the row id",async()=>{await request({provider:"manual",sourceType:"manual",quotes:[{...valid,price:101000,fetchedAt:"2026-08-30T00:00:00Z"}]},"secret");const rows=await env.DB.prepare("SELECT id,price,fetched_at,last_seen_at FROM buyback_quotes WHERE provider='manual' AND external_id='quote-1'").all<any>();expect(rows.results).toHaveLength(1);expect(rows.results[0].price).toBe(101000);expect(rows.results[0].fetched_at).toBe("2026-08-30T00:00:00.000Z");expect(rows.results[0].last_seen_at).toBeTruthy();});
});
