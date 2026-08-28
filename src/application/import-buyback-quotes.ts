import type {BuybackQuote, BuybackSourceType, BuybackStatus, ProductCategory, ProductCondition} from "../domain";
import type {BuybackQuoteRepository} from "./buyback-quote-repository";
import type {ProductMatchResult, ProductResolver} from "./product-resolver";

const conditions: ProductCondition[] = ["new", "unused", "used", "refurbished", "unknown"];
const statuses: BuybackStatus[] = ["accepting", "paused", "unavailable", "unknown"];
const sourceTypes: BuybackSourceType[] = ["scraper", "csv", "manual", "api", "partner_feed"];
const categories: ProductCategory[] = ["smartphone", "tablet", "game_console", "camera", "computer", "home_appliance", "audio", "other"];

export type BuybackQuoteInput = {
  externalId?: unknown; productName?: unknown; jan?: unknown; modelNumber?: unknown; brand?: unknown;
  category?: unknown; condition?: unknown; attributes?: unknown; price?: unknown; shippingFee?: unknown;
  fee?: unknown; buybackStatus?: unknown; productUrl?: unknown; fetchedAt?: unknown;
};
export type ImportBuybackQuotesInput = {provider: unknown; sourceType: unknown; quotes: BuybackQuoteInput[]};
export type ImportQuoteResult = {index: number; accepted: boolean; id?: string; match?: ProductMatchResult; errors?: string[]};

const optionalString = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const validMoney = (value: unknown, positive: boolean): value is number =>
  Number.isSafeInteger(value) && (positive ? Number(value) > 0 : Number(value) >= 0);

export function validateBuybackQuote(provider: unknown, sourceType: unknown, quote: BuybackQuoteInput): string[] {
  const errors: string[] = [];
  if (typeof provider !== "string" || !provider.trim()) errors.push("provider is required");
  if (typeof quote.productName !== "string" || !quote.productName.trim()) errors.push("productName is required");
  if (!validMoney(quote.price, true)) errors.push("price must be a positive safe integer");
  if (!conditions.includes(quote.condition as ProductCondition)) errors.push("condition is invalid");
  if (!statuses.includes(quote.buybackStatus as BuybackStatus)) errors.push("buybackStatus is invalid");
  if (!sourceTypes.includes(sourceType as BuybackSourceType)) errors.push("sourceType is invalid");
  if (typeof quote.fetchedAt !== "string" || !quote.fetchedAt.trim() || Number.isNaN(Date.parse(quote.fetchedAt))) errors.push("fetchedAt is invalid");
  if (quote.shippingFee !== undefined && !validMoney(quote.shippingFee, false)) errors.push("shippingFee must be a non-negative safe integer");
  if (quote.fee !== undefined && !validMoney(quote.fee, false)) errors.push("fee must be a non-negative safe integer");
  if (quote.category !== undefined && !categories.includes(quote.category as ProductCategory)) errors.push("category is invalid");
  if (quote.attributes !== undefined && (!quote.attributes || typeof quote.attributes !== "object" || Array.isArray(quote.attributes))) errors.push("attributes must be an object");
  return errors;
}

export class ImportBuybackQuotes {
  constructor(private readonly repository: BuybackQuoteRepository, private readonly resolver: ProductResolver) {}

  async execute(input: ImportBuybackQuotesInput): Promise<ImportQuoteResult[]> {
    const results: ImportQuoteResult[] = [];
    for (const [index, raw] of input.quotes.entries()) {
      const errors = validateBuybackQuote(input.provider, input.sourceType, raw);
      if (errors.length) { results.push({index, accepted: false, errors}); continue; }
      const now = new Date().toISOString();
      const quote: BuybackQuote = {
        id: crypto.randomUUID(), provider: String(input.provider).trim(), sourceType: input.sourceType as BuybackSourceType,
        externalId: optionalString(raw.externalId), productName: String(raw.productName).trim(), jan: optionalString(raw.jan),
        modelNumber: optionalString(raw.modelNumber), brand: optionalString(raw.brand), category: raw.category as ProductCategory | undefined,
        condition: raw.condition as ProductCondition, attributes: (raw.attributes ?? {}) as Record<string, unknown>,
        price: Number(raw.price), shippingFee: Number(raw.shippingFee ?? 0), fee: Number(raw.fee ?? 0),
        buybackStatus: raw.buybackStatus as BuybackStatus, productUrl: optionalString(raw.productUrl),
        fetchedAt: new Date(String(raw.fetchedAt)).toISOString(), lastSeenAt: now,
      };
      const match = await this.resolver.resolve(quote);
      if (match.matched) quote.productId = match.matchedProductId;
      quote.matchConfidence = match.confidence;
      quote.matchReason = match.reason;
      await this.repository.upsertLatest(quote);
      results.push({index, accepted: true, id: quote.id, match});
    }
    return results;
  }
}
