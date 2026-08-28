import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline";
import { MockCollector } from "../src/mock-collector";
import migration from "../migrations/0001_init.sql?raw";

beforeAll(async()=>{
  for(const sql of migration.split(";").map(x=>x.trim()).filter(Boolean)) await env.DB.prepare(sql).run();
});
describe("research vertical slice",()=>{
  it("is idempotent and respects the 300k portfolio",async()=>{
    const at=new Date("2026-01-01T00:00:00Z"); const first=await runPipeline(env.DB,new MockCollector(),at); const again=await runPipeline(env.DB,new MockCollector(),at);
    expect(first.observations).toBe(4);expect(first.opportunities).toBe(2);expect(first.buys).toBe(1);expect(again.buys).toBe(0);
    const account=await env.DB.prepare("SELECT * FROM paper_accounts").first<any>();expect(account.initial_cash_yen).toBe(300000);expect(account.available_cash_yen).toBeGreaterThanOrEqual(0);
  });
  it("evaluates 24/48/72/168h once",async()=>{
    await runPipeline(env.DB,new MockCollector(),new Date("2026-01-01T00:00:00Z"));
    for(const hours of [24,48,72,169]) await runPipeline(env.DB,new MockCollector(),new Date(Date.parse("2026-01-01T00:00:00Z")+hours*3_600_000));
    const rows=await env.DB.prepare("SELECT horizon_hours FROM evaluations ORDER BY horizon_hours").all<any>();
    expect([...new Set(rows.results.map((x:any)=>x.horizon_hours))]).toEqual([24,48,72,168]);
    const duplicates=await env.DB.prepare(`SELECT o.product_id,COUNT(*) count FROM paper_trades t
      JOIN opportunities o ON o.id=t.opportunity_id WHERE t.status='OPEN'
      GROUP BY o.product_id HAVING COUNT(*)>1`).all();
    expect(duplicates.results).toHaveLength(0);
  });
});
