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
