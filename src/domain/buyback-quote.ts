import type {ProductAttributes, ProductCategory, ProductCondition} from "./product";

export type BuybackStatus =
  | "accepting"
  | "paused"
  | "unavailable"
  | "unknown";

export type BuybackSourceType =
  | "scraper"
  | "csv"
  | "manual"
  | "api"
  | "partner_feed";

export type BuybackQuote = {
  id: string;
  provider: string;
  sourceType: BuybackSourceType;
  externalId?: string;
  productId?: string;
  productName: string;
  jan?: string;
  modelNumber?: string;
  brand?: string;
  category?: ProductCategory;
  condition: ProductCondition;
  attributes: ProductAttributes;
  price: number;
  shippingFee: number;
  fee: number;
  buybackStatus: BuybackStatus;
  productUrl?: string;
  fetchedAt: string;
  lastSeenAt: string;
  matchConfidence?: number;
  matchReason?: string;
};

export const BUYBACK_MAX_AGE_MINUTES = 180;
export function isFreshEligibleBuybackQuote(quote:BuybackQuote,now=new Date(),maxAgeMinutes=BUYBACK_MAX_AGE_MINUTES):boolean{const fetched=Date.parse(quote.fetchedAt);return (quote.condition==="new"||quote.condition==="unused")&&quote.buybackStatus==="accepting"&&Number.isSafeInteger(quote.price)&&quote.price>0&&Boolean(quote.productId)&&Number.isFinite(fetched)&&fetched<=now.getTime()&&fetched>now.getTime()-maxAgeMinutes*60_000;}
