import {describe,expect,it} from "vitest";
import {aggregateBuybackQuotes} from "../src/application/buyback-quote-aggregator";
import type {BuybackQuote} from "../src/domain";
const now=new Date("2026-08-29T12:00:00Z");
const quote=(provider:string,price:number,overrides:Partial<BuybackQuote>={}):BuybackQuote=>({id:`${provider}-${price}`,productId:"1",provider,sourceType:"manual",productName:"Item",condition:"new",attributes:{},price,shippingFee:0,fee:0,buybackStatus:"accepting",fetchedAt:"2026-08-29T11:00:00Z",lastSeenAt:"2026-08-29T11:00:00Z",...overrides});
describe("buyback aggregation",()=>{
 it("ranks three providers and computes the best/second spread",()=>{const x=aggregateBuybackQuotes([quote("b",108000),quote("a",110000),quote("c",107000)],now)!;expect(x).toMatchObject({bestBuybackPrice:110000,bestBuybackProvider:"a",secondBuybackPrice:108000,thirdBuybackPrice:107000,buybackSourceCount:3,bestSecondSpread:2000});});
 it("uses only the latest quote from a provider",()=>{const x=aggregateBuybackQuotes([quote("a",120000,{fetchedAt:"2026-08-29T10:00:00Z"}),quote("a",110000)],now)!;expect(x.bestBuybackPrice).toBe(110000);expect(x.buybackSourceCount).toBe(1);});
 it.each(["paused","unavailable"] as const)("excludes %s quotes",status=>expect(aggregateBuybackQuotes([quote("a",110000,{buybackStatus:status})],now)).toBeNull());
 it("excludes stale quotes",()=>expect(aggregateBuybackQuotes([quote("a",110000,{fetchedAt:"2026-08-29T08:59:59Z"})],now)).toBeNull());
});
