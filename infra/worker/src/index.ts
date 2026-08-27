interface Env {
  DB: D1Database;
  INGEST_API_KEY: string;
  ALLOWED_ORIGIN: string;
}

type OpportunityRow = {
  id: number; external_key: string; name: string; category: string; source: string;
  buyer: string; image_url: string; purchase_price: number; buyback_price: number;
  base_point_rate: number; product_url: string; updated_at: string;
};

type IngestItem = {
  externalKey?: string; name: string; category: string; source: string; buyer: string;
  imageUrl?: string; purchasePrice: number; buybackPrice: number; basePointRate?: number;
  productUrl?: string; updatedAt?: string;
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function pointAdjustment(url: URL, fallback: number): number {
  const raw = url.searchParams.get("pointAdjustment");
  const value = raw === null ? fallback : Number.parseInt(raw, 10);
  return Math.max(-20, Math.min(50, Number.isFinite(value) ? value : fallback));
}

function present(row: OpportunityRow, adjustment: number) {
  const adjustedPointRate = Math.max(0, row.base_point_rate + adjustment);
  const pointValue = Math.floor(row.purchase_price * adjustedPointRate / 100);
  const effectiveCost = row.purchase_price - pointValue;
  const profit = row.buyback_price - effectiveCost;
  return {
    id: row.id, externalKey: row.external_key, name: row.name, category: row.category,
    source: row.source, buyer: row.buyer, imageUrl: row.image_url,
    purchasePrice: row.purchase_price, buybackPrice: row.buyback_price,
    basePointRate: row.base_point_rate, adjustedPointRate, pointValue, effectiveCost, profit,
    profitRate: effectiveCost > 0 ? profit / effectiveCost * 100 : 0,
    productUrl: row.product_url, updatedAt: row.updated_at,
  };
}

async function savedAdjustment(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare("SELECT point_adjustment FROM user_settings WHERE user_id = ?")
    .bind(userId).first<{ point_adjustment: number }>();
  return row?.point_adjustment ?? 0;
}

function validItem(value: unknown): value is IngestItem {
  if (!value || typeof value !== "object") return false;
  const x = value as Record<string, unknown>;
  return ["name", "category", "source", "buyer"].every(k => typeof x[k] === "string" && x[k] !== "")
    && (x.externalKey === undefined || (typeof x.externalKey === "string" && x.externalKey !== ""))
    && Number.isInteger(x.purchasePrice) && (x.purchasePrice as number) >= 0
    && Number.isInteger(x.buybackPrice) && (x.buybackPrice as number) >= 0
    && (x.basePointRate === undefined || (Number.isInteger(x.basePointRate) && (x.basePointRate as number) >= 0 && (x.basePointRate as number) <= 100));
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId = request.headers.get("x-user-id")?.slice(0, 128) || "local";
  const match = url.pathname.match(/^\/api\/opportunities\/(\d+)$/);

  if (request.method === "GET" && url.pathname === "/health") return json({ status: "ok" });

  if (request.method === "GET" && url.pathname === "/api/opportunities") {
    const adjustment = pointAdjustment(url, await savedAdjustment(env.DB, userId));
    const { results } = await env.DB.prepare("SELECT * FROM opportunities ORDER BY updated_at DESC").all<OpportunityRow>();
    return json(results.map(row => present(row, adjustment)));
  }

  if (request.method === "GET" && match) {
    const row = await env.DB.prepare("SELECT * FROM opportunities WHERE id = ?").bind(Number(match[1])).first<OpportunityRow>();
    if (!row) return json({ error: "not found" }, 404);
    return json(present(row, pointAdjustment(url, await savedAdjustment(env.DB, userId))));
  }

  const historyMatch = url.pathname.match(/^\/api\/(?:opportunities\/(\d+)\/history|history\/(\d+))$/);
  if (request.method === "GET" && historyMatch) {
    const { results } = await env.DB.prepare(
      "SELECT purchase_price AS purchasePrice, buyback_price AS buybackPrice, base_point_rate AS basePointRate, recorded_at AS recordedAt FROM price_history WHERE opportunity_id = ? ORDER BY recorded_at DESC LIMIT 180"
    ).bind(Number(historyMatch[1] || historyMatch[2])).all();
    return json(results);
  }

  if (request.method === "GET" && url.pathname === "/api/settings") {
    const row = await env.DB.prepare("SELECT point_adjustment, min_profit, min_profit_rate, updated_at FROM user_settings WHERE user_id = ?")
      .bind(userId).first<{point_adjustment:number; min_profit:number; min_profit_rate:number; updated_at:string}>();
    return json({ userId, pointAdjustment: row?.point_adjustment ?? 0, minimumProfit: row?.min_profit ?? 0, minimumProfitRate: row?.min_profit_rate ?? 0, updatedAt: row?.updated_at ?? null });
  }

  if (request.method === "PUT" && url.pathname === "/api/settings") {
    const body: Record<string, unknown> = await request.json<Record<string, unknown>>().catch(() => ({}));
    const adjustment = Number(body.pointAdjustment), minProfit = Number(body.minimumProfit ?? body.minProfit ?? 0), minRate = Number(body.minimumProfitRate ?? body.minProfitRate ?? 0);
    if (!Number.isInteger(adjustment) || adjustment < -20 || adjustment > 50 || minProfit < 0 || minRate < 0)
      return json({ error: "invalid settings" }, 400);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO user_settings(user_id,point_adjustment,min_profit,min_profit_rate,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET point_adjustment=excluded.point_adjustment,min_profit=excluded.min_profit,min_profit_rate=excluded.min_profit_rate,updated_at=excluded.updated_at")
      .bind(userId, adjustment, Math.floor(minProfit), minRate, now).run();
    return json({ userId, pointAdjustment: adjustment, minimumProfit: Math.floor(minProfit), minimumProfitRate: minRate, updatedAt: now });
  }

  if (request.method === "GET" && url.pathname === "/api/alerts") {
    const {results}=await env.DB.prepare("SELECT id,user_id AS userId,name,minimum_profit AS minimumProfit,minimum_profit_rate AS minimumProfitRate,enabled FROM alert_rules WHERE user_id=? ORDER BY id DESC").bind(userId).all();return json(results);
  }
  if (request.method === "POST" && url.pathname === "/api/alerts") {
    const body:Record<string,unknown>=await request.json<Record<string,unknown>>().catch(()=>({}));const name=String(body.name??"").trim(),minProfit=Number(body.minimumProfit??0),minRate=Number(body.minimumProfitRate??0);if(!name||name.length>100||minProfit<0||minRate<0)return json({error:"invalid alert"},400);
    const result=await env.DB.prepare("INSERT INTO alert_rules(user_id,name,minimum_profit,minimum_profit_rate,enabled) VALUES(?,?,?,?,1)").bind(userId,name,Math.floor(minProfit),minRate).run();return json({id:result.meta.last_row_id,userId,name,minimumProfit:Math.floor(minProfit),minimumProfitRate:minRate,enabled:true},201);
  }
  if (request.method === "GET" && url.pathname === "/api/notifications") {
    const limit=Math.max(1,Math.min(200,Number.parseInt(url.searchParams.get("limit")||"50",10)||50));const {results}=await env.DB.prepare("SELECT id,user_id AS userId,alert_rule_id AS alertRuleId,opportunity_id AS opportunityId,title,body,status,created_at AS createdAt FROM notification_outbox WHERE user_id=? ORDER BY id DESC LIMIT ?").bind(userId,limit).all();return json(results);
  }
  if (request.method === "GET" && url.pathname === "/api/collector/status") {
    const limit=Math.max(1,Math.min(100,Number.parseInt(url.searchParams.get("limit")||"20",10)||20));const {results}=await env.DB.prepare("SELECT id,run_id AS runId,source,status,item_count AS itemCount,message,started_at AS startedAt,finished_at AS finishedAt FROM collector_runs ORDER BY id DESC LIMIT ?").bind(limit).all();return json({lastRun:results[0]??null,runs:results});
  }
  if (request.method === "POST" && url.pathname === "/api/collector/runs") {
    if(!env.INGEST_API_KEY||request.headers.get("authorization")!==`Bearer ${env.INGEST_API_KEY}`)return json({error:"unauthorized"},401);const x:Record<string,unknown>=await request.json<Record<string,unknown>>().catch(()=>({}));
    if(typeof x.runId!=="string"||!x.runId||typeof x.source!=="string"||!x.source||!["running","succeeded","failed"].includes(String(x.status))||Number(x.itemCount??0)<0||String(x.message??"").length>1000)return json({error:"invalid collector run"},400);
    await env.DB.prepare("INSERT INTO collector_runs(run_id,source,status,item_count,message,started_at,finished_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET source=excluded.source,status=excluded.status,item_count=excluded.item_count,message=excluded.message,started_at=excluded.started_at,finished_at=excluded.finished_at").bind(x.runId,x.source,x.status,Math.floor(Number(x.itemCount??0)),String(x.message??""),String(x.startedAt??""),String(x.finishedAt??"")).run();return json(x,202);
  }

  if (request.method === "POST" && (url.pathname === "/api/ingest/opportunities" || url.pathname === "/api/ingest")) {
    if (!env.INGEST_API_KEY || request.headers.get("authorization") !== `Bearer ${env.INGEST_API_KEY}`)
      return json({ error: "unauthorized" }, 401);
    const payload = await request.json<unknown>().catch(() => null);
    const items = Array.isArray(payload) ? payload : (payload as { items?: unknown[] } | null)?.items;
    if (!Array.isArray(items) || items.length > 500 || !items.every(validItem)) return json({ error: "invalid payload" }, 400);
    const now = new Date().toISOString();
    for (const item of items) {
      const updatedAt = item.updatedAt || now;
      const externalKey = item.externalKey || `${item.source}:${item.buyer}:${item.name}`;
      await env.DB.prepare("INSERT INTO opportunities(external_key,name,category,source,buyer,image_url,purchase_price,buyback_price,base_point_rate,product_url,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(external_key) DO UPDATE SET name=excluded.name,category=excluded.category,source=excluded.source,buyer=excluded.buyer,image_url=excluded.image_url,purchase_price=excluded.purchase_price,buyback_price=excluded.buyback_price,base_point_rate=excluded.base_point_rate,product_url=excluded.product_url,updated_at=excluded.updated_at")
        .bind(externalKey,item.name,item.category,item.source,item.buyer,item.imageUrl ?? "",item.purchasePrice,item.buybackPrice,item.basePointRate ?? 0,item.productUrl ?? "",updatedAt).run();
      await env.DB.prepare("INSERT INTO price_history(opportunity_id,purchase_price,buyback_price,base_point_rate,recorded_at) SELECT id,?,?,?,? FROM opportunities WHERE external_key=?")
        .bind(item.purchasePrice,item.buybackPrice,item.basePointRate ?? 0,updatedAt,externalKey).run();
    }
    const {results:rules}=await env.DB.prepare("SELECT a.id,a.user_id,a.name,a.minimum_profit,a.minimum_profit_rate,COALESCE(u.point_adjustment,0) AS adjustment FROM alert_rules a LEFT JOIN user_settings u ON u.user_id=a.user_id WHERE a.enabled=1").all<{id:number;user_id:string;name:string;minimum_profit:number;minimum_profit_rate:number;adjustment:number}>();
    let notificationsCreated=0;
    for(const rule of rules){for(const item of items){const externalKey=item.externalKey||`${item.source}:${item.buyer}:${item.name}`;const opportunity=await env.DB.prepare("SELECT id FROM opportunities WHERE external_key=?").bind(externalKey).first<{id:number}>();if(!opportunity)continue;const rate=Math.max(0,(item.basePointRate??0)+rule.adjustment),cost=item.purchasePrice-Math.floor(item.purchasePrice*rate/100),profit=item.buybackPrice-cost,profitRate=cost>0?profit/cost*100:0;if(profit<rule.minimum_profit||profitRate<rule.minimum_profit_rate)continue;const fingerprint=`${item.purchasePrice}:${item.buybackPrice}:${item.basePointRate??0}:${rule.adjustment}`;const result=await env.DB.prepare("INSERT OR IGNORE INTO notification_outbox(user_id,alert_rule_id,opportunity_id,fingerprint,title,body) VALUES(?,?,?,?,?,?)").bind(rule.user_id,rule.id,opportunity.id,fingerprint,rule.name,`${item.name} の見込み利益は ${profit}円（${profitRate.toFixed(1)}%）です`).run();notificationsCreated+=result.meta.changes;}}
    return json({ accepted: items.length, notificationsCreated }, 202);
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin") || "";
    const cors: Record<string, string> = origin && (origin === env.ALLOWED_ORIGIN || origin.endsWith(".pages.dev"))
      ? { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization,content-type,x-user-id", "access-control-allow-methods": "GET,POST,PUT,OPTIONS", vary: "Origin" }
      : {};
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const response = await route(request, env);
      Object.entries(cors).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    } catch (error) {
      console.error(error);
      return json({ error: "internal server error" }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
