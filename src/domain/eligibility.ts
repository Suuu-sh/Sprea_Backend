import type {BuybackQuote} from "./buyback-quote";
import type {RetailListing} from "./retail-listing";

export function isEligibleRetailListing(listing: RetailListing): boolean {
  return listing.condition === "new"
    && listing.purchasable
    && (listing.stockStatus === "in_stock" || listing.stockStatus === "low_stock");
}

export function isEligibleBuybackQuote(quote: BuybackQuote): boolean {
  return quote.condition === "new" && quote.buybackStatus === "accepting";
}
