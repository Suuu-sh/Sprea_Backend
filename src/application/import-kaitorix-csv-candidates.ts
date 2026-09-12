import type {D1Database} from "@cloudflare/workers-types";
import type {KaitorixCsvCandidate} from "./kaitorix-csv";

export type ImportKaitorixCsvCandidatesResult = {
  accepted: number;
  storesWritten: number;
  date: string;
};

const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
const validJan = (value: string): boolean => /^\d{8,14}$/.test(value);

/**
 * Project the filtered CSV queue into the existing buyback quote engine.
 *
 * Only the best store quote is materialised as a listing; the top store
 * summaries remain in attributes_json for auditability.  This keeps the daily
 * D1 write volume proportional to products rather than products x stores,
 * while `buyback_daily_stats` retains the best-price history for stability.
 */
export async function importKaitorixCsvCandidates(
  db: D1Database,
  date: string,
  candidates: KaitorixCsvCandidate[],
  replace = false,
  at = new Date(),
): Promise<ImportKaitorixCsvCandidatesResult> {
  if (!validDate(date)) throw new Error("snapshot date must be YYYY-MM-DD");
  if (candidates.length > 500 || (candidates.length === 0 && !replace)) throw new Error("candidates must contain between 1 and 500 items, or be empty for a replacement batch");

  // The first batch is only a marker for the caller.  We do not scan and
  // update every historical CSV row here: that full-table UPDATE would consume
  // D1's read quota.  Active-snapshot filtering is applied when candidates and
  // buyback listings are queried instead.

  const statements: D1PreparedStatement[] = [];
  let accepted = 0;
  let storesWritten = 0;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || !validJan(candidate.jan) || typeof candidate.productName !== "string" || !candidate.productName.trim() || !Array.isArray(candidate.stores)) continue;
    const stores = candidate.stores
      .filter(store => store && typeof store.provider === "string" && store.provider.trim() && Number.isSafeInteger(store.price) && store.price > 0 && typeof store.fetchedAt === "string" && !Number.isNaN(Date.parse(store.fetchedAt)))
      .sort((left, right) => right.price - left.price);
    if (!stores.length) continue;
    const best = stores[0];
    const attributes = JSON.stringify({
      msrp: candidate.msrp ?? null,
      source: "kaitorix-csv",
      snapshotDate: date,
      storeCount: Math.max(1, Math.floor(candidate.storeCount || stores.length)),
      stores: stores.slice(0, 5),
    });
    const externalId = `${candidate.jan}:best`;
    const now = at.toISOString();
    statements.push(db.prepare(`INSERT INTO buyback_quotes
      (id,product_id,provider,source_type,external_id,product_name,jan,model_number,brand,category,condition,attributes_json,price,shipping_fee,fee,buyback_status,product_url,fetched_at,last_seen_at,created_at,updated_at,match_confidence,match_reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider,external_id) WHERE external_id IS NOT NULL AND external_id <> '' DO UPDATE SET
      source_type=excluded.source_type,product_name=excluded.product_name,jan=excluded.jan,category=excluded.category,
      condition=excluded.condition,attributes_json=excluded.attributes_json,price=excluded.price,shipping_fee=0,fee=0,
      buyback_status='accepting',fetched_at=excluded.fetched_at,last_seen_at=excluded.last_seen_at,
      updated_at=excluded.updated_at,match_confidence=1,match_reason='jan_exact'`).bind(
      crypto.randomUUID(), null, best.provider, "csv", externalId, candidate.productName, candidate.jan, null, null,
      candidate.category ?? null, candidate.condition, attributes, best.price, 0, 0, "accepting", null,
      best.fetchedAt, now, now, now, 1, "jan_exact",
    ));
    const day = best.fetchedAt.slice(0, 10);
    statements.push(db.prepare(`INSERT INTO buyback_daily_stats
      (jan,provider,day,latest_price,latest_fetched_at,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(jan,provider,day) DO UPDATE SET
      latest_price=excluded.latest_price,latest_fetched_at=excluded.latest_fetched_at,updated_at=excluded.updated_at
      WHERE excluded.latest_fetched_at >= buyback_daily_stats.latest_fetched_at`).bind(candidate.jan, best.provider, day, best.price, best.fetchedAt, now));
    accepted += 1;
    storesWritten += 1;
  }
  for (let index = 0; index < statements.length; index += 100) await db.batch(statements.slice(index, index + 100));
  return {accepted, storesWritten, date};
}
