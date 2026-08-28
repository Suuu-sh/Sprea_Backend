import type {BuybackQuote} from "./buyback-quote";
import type {RetailListing} from "./retail-listing";

export type BuybackProviderResult = {
  quotes: BuybackQuote[];
  fetchedAt: string;
};

export interface BuybackProvider {
  readonly name: string;
  collect(): Promise<BuybackProviderResult>;
}

export type RetailProviderResult = {
  listings: RetailListing[];
  fetchedAt: string;
};

export interface RetailProvider {
  readonly name: string;
  collect(): Promise<RetailProviderResult>;
}
