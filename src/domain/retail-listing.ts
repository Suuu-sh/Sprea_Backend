import type {ProductAttributes, ProductCategory, ProductCondition} from "./product";

export type StockStatus =
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "preorder"
  | "unknown";

export const RETAIL_MAX_AGE_MINUTES = 120;
export function stockStatusFromYahoo(value:unknown):StockStatus{return value===true?"in_stock":value===false?"out_of_stock":"unknown";}
export function stockStatusFromQuantity(value:unknown):StockStatus{return Number.isInteger(value)?Number(value)>0?"in_stock":"out_of_stock":"unknown";}
export function isFreshRetailListing(listing:Pick<RetailListing,"fetchedAt">,now=new Date(),maxAgeMinutes=RETAIL_MAX_AGE_MINUTES):boolean{const fetched=Date.parse(listing.fetchedAt);return Number.isFinite(fetched)&&fetched<=now.getTime()&&fetched>now.getTime()-maxAgeMinutes*60_000;}
export function hasValidProductUrl(value:string|undefined):boolean{if(!value)return false;try{const url=new URL(value);return url.protocol==="http:"||url.protocol==="https:";}catch{return false;}}
export function isPurchasableRetailListing(listing:Pick<RetailListing,"condition"|"stockStatus"|"price"|"productUrl"|"fetchedAt">,now=new Date(),maxAgeMinutes=RETAIL_MAX_AGE_MINUTES):boolean{return listing.condition==="new"&&(listing.stockStatus==="in_stock"||listing.stockStatus==="low_stock")&&Number.isSafeInteger(listing.price)&&listing.price>0&&hasValidProductUrl(listing.productUrl)&&isFreshRetailListing(listing,now,maxAgeMinutes);}

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
