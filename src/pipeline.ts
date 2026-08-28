import type { Collector, Observation, RunSummary } from "./types";

const HORIZONS = [24, 48, 72, 168];
const isoBucket = (iso: string) => iso.slice(0, 13);

async function resolve(db: D1Database, o: Observation): Promise<number> {
  if (o.condition !== "new" || !o.modelNumber || !o.capacityGb) throw new Error("unresolvable observation");
  await db.prepare(`INSERT INTO products(jan,model_number,capacity_gb,name,condition,created_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(model_number,capacity_gb,condition) DO UPDATE SET jan=COALESCE(excluded.jan,jan),name=excluded.name`)
    .bind(o.jan ?? null, o.modelNumber, o.capacityGb, o.title, o.condition, o.capturedAt).run();
  const row = await db.prepare("SELECT id FROM products WHERE model_number=? AND capacity_gb=? AND condition=?")
    .bind(o.modelNumber, o.capacityGb, o.condition).first<{id:number}>();
  if (!row) throw new Error("product resolution failed");
  return row.id;
}

async function storeObservation(db: D1Database, productId: number, o: Observation): Promise<void> {
  await db.prepare(`INSERT INTO source_listings(product_id,source,external_id,side,title,raw_json,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET product_id=excluded.product_id,title=excluded.title,raw_json=excluded.raw_json,updated_at=excluded.updated_at`)
    .bind(productId,o.source,o.externalId,o.side,o.title,JSON.stringify(o.raw),o.capturedAt).run();
  const listing = await db.prepare("SELECT id FROM source_listings WHERE source=? AND external_id=?").bind(o.source,o.externalId).first<{id:number}>();
  await db.prepare(`INSERT OR IGNORE INTO price_snapshots(listing_id,price_yen,shipping_yen,fee_yen,reward_yen,stock,captured_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(listing!.id,o.priceYen,o.shippingYen,o.feeYen,o.rewardYen,o.stock,o.capturedAt).run();
}

async function createOpportunities(db: D1Database, at: Date): Promise<{created:number,buys:number}> {
  const pairs = await db.prepare(`WITH latest AS (
    SELECT sl.product_id,sl.side,ps.*,ROW_NUMBER() OVER(PARTITION BY sl.product_id,sl.side ORDER BY ps.captured_at DESC,ps.id DESC) rn
    FROM price_snapshots ps JOIN source_listings sl ON sl.id=ps.listing_id WHERE ps.stock>0)
    SELECT b.product_id,b.id buy_id,s.id sell_id,b.price_yen+b.shipping_yen-b.reward_yen buy_cost,
      s.price_yen-s.shipping_yen-s.fee_yen revenue
    FROM latest b JOIN latest s ON s.product_id=b.product_id WHERE b.side='buy' AND s.side='sell' AND b.rn=1 AND s.rn=1`).all<any>();
  let created=0, buys=0;
  for (const p of pairs.results) {
    const profit=p.revenue-p.buy_cost; const decision=profit>=5000?"BUY":"SKIP";
    const fingerprint=`${p.product_id}:${p.buy_id}:${p.sell_id}:${isoBucket(at.toISOString())}`;
    const res=await db.prepare(`INSERT OR IGNORE INTO opportunities(product_id,buy_snapshot_id,sell_snapshot_id,buy_cost_yen,expected_revenue_yen,market_profit_yen,resolver_confidence,features_json,decision,detected_at,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(p.product_id,p.buy_id,p.sell_id,p.buy_cost,p.revenue,profit,1,JSON.stringify({buy_cost_yen:p.buy_cost,market_profit_yen:profit}),decision,at.toISOString(),fingerprint).run();
    if (!res.meta.changes) continue; created++;
    const opp=await db.prepare("SELECT id FROM opportunities WHERE fingerprint=?").bind(fingerprint).first<{id:number}>();
    if(decision==="BUY") {
      const account=await db.prepare("SELECT available_cash_yen FROM paper_accounts WHERE id=1").first<{available_cash_yen:number}>();
      if(account && account.available_cash_yen>=p.buy_cost) {
        await db.batch([
          db.prepare("INSERT OR IGNORE INTO paper_trades(opportunity_id,reserved_yen,opened_at) VALUES(?,?,?)").bind(opp!.id,p.buy_cost,at.toISOString()),
          db.prepare("UPDATE paper_accounts SET available_cash_yen=available_cash_yen-?,reserved_cash_yen=reserved_cash_yen+?,updated_at=? WHERE id=1").bind(p.buy_cost,p.buy_cost,at.toISOString())
        ]); buys++;
      }
    }
  }
  return {created,buys};
}

async function evaluate(db:D1Database, at:Date):Promise<number>{
  const due=await db.prepare(`SELECT o.id opportunity_id,o.product_id,o.decision,o.buy_cost_yen,t.id trade_id,t.reserved_yen,o.detected_at
    FROM opportunities o LEFT JOIN paper_trades t ON t.opportunity_id=o.id`).all<any>();
  let count=0;
  for(const row of due.results) for(const horizon of HORIZONS){
    const target=new Date(new Date(row.detected_at).getTime()+horizon*3600000);
    if(target>at) continue;
    const sell=await db.prepare(`SELECT ps.id,ps.price_yen-ps.shipping_yen-ps.fee_yen revenue FROM price_snapshots ps JOIN source_listings sl ON sl.id=ps.listing_id
      WHERE sl.product_id=? AND sl.side='sell' AND ps.captured_at>=? ORDER BY ps.captured_at ASC LIMIT 1`).bind(row.product_id,target.toISOString()).first<any>();
    if(!sell) continue;
    const profit=sell.revenue-row.buy_cost_yen; const good=profit>=5000;
    const outcome=row.decision==="BUY"?(good?"buy_correct":"buy_failed"):(good?"missed_opportunity":"skip_correct");
    const result=await db.prepare("INSERT OR IGNORE INTO evaluations(opportunity_id,trade_id,horizon_hours,sell_snapshot_id,realized_profit_yen,outcome,evaluated_at) VALUES(?,?,?,?,?,?,?)")
      .bind(row.opportunity_id,row.trade_id??null,horizon,sell.id,profit,outcome,at.toISOString()).run();
    count+=result.meta.changes??0;
    if(horizon===168 && row.trade_id && result.meta.changes){
      await db.batch([
        db.prepare("UPDATE paper_trades SET status='CLOSED',closed_at=? WHERE id=? AND status='OPEN'").bind(at.toISOString(),row.trade_id),
        db.prepare("UPDATE paper_accounts SET available_cash_yen=available_cash_yen+?,reserved_cash_yen=reserved_cash_yen-?,updated_at=? WHERE id=1").bind(row.reserved_yen,row.reserved_yen,at.toISOString())
      ]);
    }
  }
  return count;
}

export async function runPipeline(db:D1Database,collector:Collector,at=new Date()):Promise<RunSummary>{
  const observations=await collector.collect(at); const products=new Set<number>();
  for(const o of observations){const id=await resolve(db,o);products.add(id);await storeObservation(db,id,o);}
  const opportunities=await createOpportunities(db,at); const evaluations=await evaluate(db,at);
  return {observations:observations.length,products:products.size,opportunities:opportunities.created,buys:opportunities.buys,evaluations};
}
