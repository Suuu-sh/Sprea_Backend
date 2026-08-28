export type ListingSide = "purchase" | "buyback";
export type Condition = "new" | "used" | "refurbished";
export interface ProductIdentity { gtin?:string; manufacturerPartNumber?:string; brand?:string; model:string; variant?:string; category?:string; capacity?:string; color?:string; condition?:Condition; }
export interface ListingObservation extends ProductIdentity {
  source:string; externalId:string; side:ListingSide; title:string; url?:string; priceYen:number;
  shippingYen?:number; feeYen?:number; rewardYen?:number; stock:number; capturedAt:string; raw?:unknown;
  stockStatus?: import("./domain/retail-listing").StockStatus; purchasable?:boolean;
}
/** Real collectors live outside the Worker and submit this neutral contract. */
export interface Collector { collect(at:Date):Promise<ListingObservation[]>; }
export interface RunSummary { observations:number; products:number; snapshots:number; opportunities:number; buys:number; evaluations:number; }
export interface IngestPayload { runId:string; source:string; startedAt?:string; finishedAt?:string; listings:ListingObservation[]; }
