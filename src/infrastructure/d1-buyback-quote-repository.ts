import type {BuybackQuote, BuybackSourceType, BuybackStatus, ProductCategory, ProductCondition} from "../domain";
import type {BuybackQuoteRepository} from "../application/buyback-quote-repository";

type Row = Record<string, unknown>;
const money = (value: unknown, field: string, positive = false): number => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || (positive ? number <= 0 : number < 0)) throw new Error(`Invalid ${field}`);
  return number;
};
const textOrUndefined = (value: unknown): string | undefined => typeof value === "string" && value.length ? value : undefined;

export class D1BuybackQuoteRepository implements BuybackQuoteRepository {
  constructor(private readonly db: D1Database) {}
  async upsertLatest(quote: BuybackQuote): Promise<void> {
    const price = money(quote.price, "price", true), shipping = money(quote.shippingFee, "shippingFee"), fee = money(quote.fee, "fee");
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO buyback_quotes
      (id,product_id,provider,source_type,external_id,product_name,jan,model_number,brand,category,condition,attributes_json,price,shipping_fee,fee,buyback_status,product_url,fetched_at,last_seen_at,created_at,updated_at,match_confidence,match_reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider,external_id) WHERE external_id IS NOT NULL AND external_id <> '' DO UPDATE SET
      product_id=excluded.product_id,source_type=excluded.source_type,product_name=excluded.product_name,jan=excluded.jan,
      model_number=excluded.model_number,brand=excluded.brand,category=excluded.category,condition=excluded.condition,
      attributes_json=excluded.attributes_json,price=excluded.price,shipping_fee=excluded.shipping_fee,fee=excluded.fee,
      buyback_status=excluded.buyback_status,product_url=excluded.product_url,fetched_at=excluded.fetched_at,
      last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at,match_confidence=excluded.match_confidence,match_reason=excluded.match_reason`).bind(
      quote.id, quote.productId ?? null, quote.provider, quote.sourceType, quote.externalId ?? null, quote.productName,
      quote.jan ?? null, quote.modelNumber ?? null, quote.brand ?? null, quote.category ?? null, quote.condition,
      JSON.stringify(quote.attributes), price, shipping, fee, quote.buybackStatus, quote.productUrl ?? null,
      quote.fetchedAt, quote.lastSeenAt, now, now, quote.matchConfidence ?? 0, quote.matchReason ?? "unresolved",
    ).run();
  }
  async findLatestByProductId(productId: string): Promise<BuybackQuote[]> { return this.query("product_id=?", productId, true); }
  async findLatestByJan(jan: string): Promise<BuybackQuote[]> { return jan.trim() ? this.query("jan=?", jan.trim(), true) : []; }
  async findLatestByProvider(provider: string): Promise<BuybackQuote[]> { return this.query("provider=?", provider, false); }
  private async query(where: string, value: string, onePerProvider: boolean): Promise<BuybackQuote[]> {
    const rows = (await this.db.prepare(`SELECT * FROM buyback_quotes WHERE ${where} ORDER BY fetched_at DESC`).bind(value).all<Row>()).results;
    const seen = new Set<string>();
    return rows.filter(row => { if (!onePerProvider) return true; const provider = String(row.provider); if (seen.has(provider)) return false; seen.add(provider); return true; }).map(row => this.map(row));
  }
  private map(row: Row): BuybackQuote {
    let attributes: Record<string, unknown> = {};
    try { const parsed = JSON.parse(String(row.attributes_json)); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attributes = parsed; } catch { attributes = {}; }
    return {id:String(row.id),productId:row.product_id == null?undefined:String(row.product_id),provider:String(row.provider),sourceType:row.source_type as BuybackSourceType,
      externalId:textOrUndefined(row.external_id),productName:String(row.product_name),jan:textOrUndefined(row.jan),modelNumber:textOrUndefined(row.model_number),brand:textOrUndefined(row.brand),category:textOrUndefined(row.category) as ProductCategory|undefined,
      condition:row.condition as ProductCondition,attributes,price:money(row.price,"price",true),shippingFee:money(row.shipping_fee,"shippingFee"),fee:money(row.fee,"fee"),buybackStatus:row.buyback_status as BuybackStatus,
      productUrl:textOrUndefined(row.product_url),fetchedAt:String(row.fetched_at),lastSeenAt:String(row.last_seen_at),
      matchConfidence:Number(row.match_confidence??0),matchReason:String(row.match_reason??"unresolved")};
  }
}
