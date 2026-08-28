import type { Collector, ListingObservation } from "./types";

export class MockCollector implements Collector {
  async collect(at: Date): Promise<ListingObservation[]> {
    const capturedAt = at.toISOString();
    const hour = Math.floor(at.getTime() / 3_600_000);
    const wobble = (hour % 5) * 250;
    const common = { shippingYen: 0, feeYen: 0, rewardYen: 0, stock: 1, condition: "new" as const, capturedAt, brand:"Apple", category:"smartphone" };
    return [
      { ...common, source:"mock-shop", externalId:"iphone15-128-buy", side:"purchase", title:"Apple iPhone 15 128GB", priceYen:100000+wobble, gtin:"4549995420000", manufacturerPartNumber:"MTP03J/A", model:"iPhone 15", capacity:"128GB", variant:"128GB", raw:{fixture:true}},
      { ...common, source:"mock-kaitori-a", externalId:"iphone15-128-sell-a", side:"buyback", title:"iPhone 15 128GB 買取", priceYen:108000-wobble, gtin:"4549995420000", manufacturerPartNumber:"MTP03J/A", model:"iPhone 15", capacity:"128GB", variant:"128GB", raw:{fixture:true}},
      { ...common, source:"mock-kaitori-b", externalId:"iphone15-128-sell-b", side:"buyback", title:"iPhone 15 128GB 買取", priceYen:107500-wobble, gtin:"4549995420000", manufacturerPartNumber:"MTP03J/A", model:"iPhone 15", capacity:"128GB", variant:"128GB", raw:{fixture:true}},
      { ...common, source:"mock-shop", externalId:"iphone15-256-buy", side:"purchase", title:"Apple iPhone 15 256GB", priceYen:120000, manufacturerPartNumber:"MTMR3J/A", model:"iPhone 15", capacity:"256GB", variant:"256GB", raw:{fixture:true}},
      { ...common, source:"mock-kaitori-a", externalId:"iphone15-256-sell", side:"buyback", title:"iPhone 15 256GB 買取", priceYen:123500, manufacturerPartNumber:"MTMR3J/A", model:"iPhone 15", capacity:"256GB", variant:"256GB", raw:{fixture:true}}
    ];
  }
}
