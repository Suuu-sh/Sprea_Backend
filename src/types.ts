export type Side = "buy" | "sell";
export interface Observation {
  source: string; externalId: string; side: Side; title: string; priceYen: number;
  shippingYen: number; feeYen: number; rewardYen: number; stock: number;
  jan?: string; modelNumber: string; capacityGb: number; condition: "new"; capturedAt: string;
  raw: unknown;
}
export interface Collector { collect(at: Date): Promise<Observation[]>; }
export interface RunSummary { observations: number; products: number; opportunities: number; buys: number; evaluations: number; }
