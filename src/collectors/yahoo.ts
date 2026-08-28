import type { Collector, ListingObservation } from "../types";
import { appleIdentity, observation, positiveInteger } from "./catalog";
import { stockStatusFromYahoo } from "../domain";

const ENDPOINT = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";

export interface YahooCollectorOptions {
  clientId: string;
  query?: string;
  results?: number;
  fetch?: typeof globalThis.fetch;
}

type YahooHit = {
  code?: unknown; name?: unknown; price?: unknown; inStock?: unknown; condition?: unknown;
  janCode?: unknown; shipping?: { code?: unknown }; url?:unknown;
};

export class YahooCollector implements Collector {
  constructor(private readonly options: YahooCollectorOptions) {
    if (!options.clientId) throw new Error("Yahoo Client ID is required");
  }

  async collect(at: Date): Promise<ListingObservation[]> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("appid", this.options.clientId);
    url.searchParams.set("query", this.options.query ?? "Apple 新品");
    url.searchParams.set("results", String(Math.max(1, Math.min(100, this.options.results ?? 30))));
    url.searchParams.set("condition", "new");
    url.searchParams.set("in_stock", "true");
    const response = await (this.options.fetch ?? globalThis.fetch)(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Yahoo Shopping API failed (${response.status})`);
    const payload = await response.json() as { hits?: YahooHit[] };
    const capturedAt = at.toISOString();
    const result: ListingObservation[] = [];
    for (const hit of payload.hits ?? []) {
      const title = typeof hit.name === "string" ? hit.name : "";
      const identity = appleIdentity(title);
      const priceYen = positiveInteger(hit.price);
      const externalId = typeof hit.code === "string" ? hit.code : "";
      // Yahoo code 2 means free shipping. Codes 1 and 3 have no exact shipping
      // amount in this response and are therefore rejected conservatively.
      const stockStatus = stockStatusFromYahoo(hit.inStock);
      if (!identity || !priceYen || !externalId || stockStatus !== "in_stock" || hit.condition !== "new" || Number(hit.shipping?.code) !== 2) continue;
      const gtin = typeof hit.janCode === "string" && /^\d{8,14}$/.test(hit.janCode) ? hit.janCode : undefined;
      result.push(observation({ source: "yahoo-shopping", externalId, title, priceYen, gtin, ...identity, capturedAt, raw: hit, url: typeof hit.url === "string" ? hit.url : undefined, stockStatus }));
    }
    return result;
  }
}
