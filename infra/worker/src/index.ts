interface Env {
  DB: D1Database;
  INGEST_API_KEY: string;
  ALLOWED_ORIGIN: string;
  NOTIFICATION_EMAIL?: string;
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
    const { results } = await env.DB.prepare("SELECT id,user_id AS userId,name,minimum_profit AS minimumProfit,minimum_profit_rate AS minimumProfitRate,enabled FROM alert_rules WHERE user_id=? ORDER BY id DESC")
      .bind(userId).all();
    return json(results.map((x: Record<string, unknown>) => ({ ...x, enabled: Boolean(x.enabled) })));
  }

  if (request.method === "POST" && url.pathname === "/api/alerts") {
    const body: Record<string, unknown> = await request.json<Record<string, unknown>>().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const minimumProfit = Number(body.minimumProfit ?? 0), minimumProfitRate = Number(body.minimumProfitRate ?? 0);
    if (!name || !Number.isFinite(minimumProfit) || minimumProfit < 0 || !Number.isFinite(minimumProfitRate) || minimumProfitRate < 0)
      return json({ error: "invalid alert" }, 400);
    const now = new Date().toISOString();
    const result = await env.DB.prepare("INSERT INTO alert_rules(user_id,name,minimum_profit,minimum_profit_rate,enabled,created_at) VALUES(?,?,?,?,1,?)")
      .bind(userId, name, Math.floor(minimumProfit), minimumProfitRate, now).run();
    return json({ id: result.meta.last_row_id, userId, name, minimumProfit: Math.floor(minimumProfit), minimumProfitRate, enabled: true }, 201);
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
      if (env.NOTIFICATION_EMAIL) {
        const opportunity = await env.DB.prepare("SELECT * FROM opportunities WHERE external_key=?").bind(externalKey).first<OpportunityRow>();
        if (opportunity) {
          const shown = present(opportunity, 0);
          const { results: rules } = await env.DB.prepare("SELECT id,name FROM alert_rules WHERE enabled=1 AND minimum_profit<=? AND minimum_profit_rate<=?")
            .bind(shown.profit, shown.profitRate).all<{ id: number; name: string }>();
          for (const rule of rules) {
            await env.DB.prepare("INSERT OR IGNORE INTO notification_outbox(alert_rule_id,opportunity_id,recipient,subject,body,status,created_at) VALUES(?,?,?,?,?,'pending',?)")
              .bind(rule.id, opportunity.id, env.NOTIFICATION_EMAIL, `[Sprea] ${rule.name}: ${item.name}`, `${item.name}\n利益: ¥${shown.profit.toLocaleString("ja-JP")}\n利益率: ${shown.profitRate.toFixed(1)}%`, now).run();
          }
        }
      }
    }
    return json({ accepted: items.length }, 202);
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
