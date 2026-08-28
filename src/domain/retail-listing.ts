import type {ProductAttributes, ProductCategory, ProductCondition} from "./product";

export type StockStatus =
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "preorder"
  | "unknown";

export type RetailListing = {
  id: string;
  provider: string;
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
  reward: number;
  stockStatus: StockStatus;
  purchasable: boolean;
  productUrl?: string;
  fetchedAt: string;
  lastSeenAt: string;
};
