import type { Collector, Observation } from "./types";

export class MockCollector implements Collector {
  async collect(at: Date): Promise<Observation[]> {
    const capturedAt = at.toISOString();
    const hour = Math.floor(at.getTime() / 3_600_000);
    const wobble = (hour % 5) * 250;
    const common = { shippingYen: 0, feeYen: 0, rewardYen: 0, stock: 1, condition: "new" as const, capturedAt };
    return [
      { ...common, source: "mock-shop", externalId: "iphone15-128-buy", side: "buy", title: "Apple iPhone 15 128GB", priceYen: 100000 + wobble, jan: "4549995420000", modelNumber: "MTP03J/A", capacityGb: 128, raw: { fixture: true } },
      { ...common, source: "mock-kaitori", externalId: "iphone15-128-sell", side: "sell", title: "iPhone 15 128GB 買取", priceYen: 108000 - wobble, modelNumber: "MTP03J/A", capacityGb: 128, raw: { fixture: true } },
      { ...common, source: "mock-shop", externalId: "iphone15-256-buy", side: "buy", title: "Apple iPhone 15 256GB", priceYen: 120000, modelNumber: "MTMR3J/A", capacityGb: 256, raw: { fixture: true } },
      { ...common, source: "mock-kaitori", externalId: "iphone15-256-sell", side: "sell", title: "iPhone 15 256GB 買取", priceYen: 123500, modelNumber: "MTMR3J/A", capacityGb: 256, raw: { fixture: true } }
    ];
  }
}
