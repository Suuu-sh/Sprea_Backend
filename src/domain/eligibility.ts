import type {BuybackQuote} from "./buyback-quote";
import type {RetailListing} from "./retail-listing";
import {isPurchasableRetailListing} from "./retail-listing";
import {isFreshEligibleBuybackQuote} from "./buyback-quote";

export function isEligibleRetailListing(listing: RetailListing,now=new Date()): boolean {
  return listing.purchasable && isPurchasableRetailListing(listing,now);
}

export function isEligibleBuybackQuote(quote: BuybackQuote,now=new Date()): boolean {
  return isFreshEligibleBuybackQuote(quote,now);
}
