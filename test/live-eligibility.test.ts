import {describe,expect,it} from "vitest";
import {isFreshRetailListing,isPurchasableRetailListing,stockStatusFromYahoo,type RetailListing} from "../src/domain";
import {isEligibleFreshBuybackQuote} from "../src/application/buyback-quote-aggregator";
import type {BuybackQuote} from "../src/domain";
const now=new Date("2026-08-29T12:00:00Z");
const retail=(overrides:Partial<RetailListing>={}):RetailListing=>({id:"r",provider:"shop",productName:"Item",condition:"new",attributes:{},price:100000,shippingFee:0,fee:0,reward:0,stockStatus:"in_stock",purchasable:true,productUrl:"https://example.test/item",fetchedAt:"2026-08-29T11:00:00Z",lastSeenAt:"2026-08-29T11:00:00Z",...overrides});
const quote=(overrides:Partial<BuybackQuote>={}):BuybackQuote=>({id:"q",productId:"1",provider:"buyer",sourceType:"manual",productName:"Item",condition:"new",attributes:{},price:110000,shippingFee:0,fee:0,buybackStatus:"accepting",fetchedAt:"2026-08-29T11:00:00Z",lastSeenAt:"2026-08-29T11:00:00Z",...overrides});
describe("live listing eligibility",()=>{
 it("maps Yahoo inStock into the shared stock status",()=>{expect(stockStatusFromYahoo(true)).toBe("in_stock");expect(stockStatusFromYahoo(false)).toBe("out_of_stock");expect(stockStatusFromYahoo(undefined)).toBe("unknown");});
 it.each([["in_stock",true],["low_stock",true],["out_of_stock",false],["preorder",false],["unknown",false]] as const)("handles %s stock",(stockStatus,eligible)=>expect(isPurchasableRetailListing(retail({stockStatus}),now)).toBe(eligible));
 it("accepts a one-hour retail listing and rejects a three-hour listing",()=>{expect(isFreshRetailListing(retail(),now)).toBe(true);expect(isFreshRetailListing(retail({fetchedAt:"2026-08-29T09:00:00Z"}),now)).toBe(false);});
 it("accepts a one-hour buyback and rejects a four-hour quote",()=>{expect(isEligibleFreshBuybackQuote(quote(),now)).toBe(true);expect(isEligibleFreshBuybackQuote(quote({fetchedAt:"2026-08-29T08:00:00Z"}),now)).toBe(false);});
 it("requires a valid URL and positive price",()=>{expect(isPurchasableRetailListing(retail({productUrl:undefined}),now)).toBe(false);expect(isPurchasableRetailListing(retail({price:0}),now)).toBe(false);});
});
