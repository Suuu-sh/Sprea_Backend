import type {BuybackQuote} from "../domain";

export const BUYBACK_FRESHNESS_MS = 3 * 60 * 60 * 1000;

export type RankedBuyback = {price:number; provider:string; quote:BuybackQuote};
export type BuybackQuoteAggregate = {
  bestBuybackPrice:number; bestBuybackProvider:string;
  secondBuybackPrice:number|null; secondBuybackProvider:string|null;
  thirdBuybackPrice:number|null; thirdBuybackProvider:string|null;
  buybackSourceCount:number; bestSecondSpread:number|null;
  ranked:RankedBuyback[];
};

export function isEligibleFreshBuybackQuote(quote:BuybackQuote, now=new Date(), freshnessMs=BUYBACK_FRESHNESS_MS):boolean {
  const fetched=Date.parse(quote.fetchedAt);
  return quote.condition==="new" && quote.buybackStatus==="accepting" && quote.price>0 && Boolean(quote.productId)
    && Number.isFinite(fetched) && fetched<=now.getTime() && fetched>=now.getTime()-freshnessMs;
}

export function aggregateBuybackQuotes(quotes:BuybackQuote[],now=new Date(),freshnessMs=BUYBACK_FRESHNESS_MS):BuybackQuoteAggregate|null {
  const latest=new Map<string,BuybackQuote>();
  for(const quote of quotes){const current=latest.get(quote.provider);if(!current||Date.parse(quote.fetchedAt)>Date.parse(current.fetchedAt))latest.set(quote.provider,quote);}
  const ranked=[...latest.values()].filter(quote=>isEligibleFreshBuybackQuote(quote,now,freshnessMs))
    .sort((a,b)=>b.price-a.price||a.provider.localeCompare(b.provider)).map(quote=>({price:quote.price,provider:quote.provider,quote}));
  if(!ranked.length)return null;
  return {bestBuybackPrice:ranked[0].price,bestBuybackProvider:ranked[0].provider,
    secondBuybackPrice:ranked[1]?.price??null,secondBuybackProvider:ranked[1]?.provider??null,
    thirdBuybackPrice:ranked[2]?.price??null,thirdBuybackProvider:ranked[2]?.provider??null,
    buybackSourceCount:ranked.length,bestSecondSpread:ranked[1]?ranked[0].price-ranked[1].price:null,ranked};
}
