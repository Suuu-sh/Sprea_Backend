import type { Collector, ListingObservation } from "../types";
import { appleIdentity, observation, positiveInteger } from "./catalog";
import { stockStatusFromQuantity } from "../domain";

const ENDPOINT = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

export interface RakutenCollectorOptions {
  applicationId: string;
  accessKey: string;
  keyword?: string;
  hits?: number;
  fetch?: typeof globalThis.fetch;
}

type RakutenItem = {
  itemCode?: unknown; itemName?: unknown; itemPrice?: unknown; itemUrl?: unknown;
  availability?: unknown; postageFlag?: unknown;
};

export class RakutenCollector implements Collector {
  constructor(private readonly options: RakutenCollectorOptions) {
    if (!options.applicationId || !options.accessKey) throw new Error("Rakuten credentials are required");
  }

  async collect(at: Date): Promise<ListingObservation[]> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("applicationId", this.options.applicationId);
    url.searchParams.set("keyword", this.options.keyword ?? "Apple 新品");
    url.searchParams.set("hits", String(Math.max(1, Math.min(30, this.options.hits ?? 30))));
    url.searchParams.set("format", "json");
    url.searchParams.set("formatVersion", "2");
    url.searchParams.set("availability", "1");
    url.searchParams.set("postageFlag", "1");
    const response = await (this.options.fetch ?? globalThis.fetch)(url, {
      headers: { accessKey: this.options.accessKey, accept: "application/json", origin: "https://sprea-frontend.pages.dev", referer: "https://sprea-frontend.pages.dev/" },
    });
    if (!response.ok) throw new Error(`Rakuten API failed (${response.status})`);
    const payload = await response.json() as { items?: Array<RakutenItem | { item?: RakutenItem }> };
    const capturedAt = at.toISOString();
    const result: ListingObservation[] = [];
    for (const wrapped of payload.items ?? []) {
      const item = "item" in wrapped && wrapped.item ? wrapped.item : wrapped as RakutenItem;
      const title = typeof item.itemName === "string" ? item.itemName : "";
      const identity = appleIdentity(title);
      const priceYen = positiveInteger(item.itemPrice);
      const externalId = typeof item.itemCode === "string" ? item.itemCode : "";
      // The API exposes only a postage flag, not an exact amount. Keep only
      // postage-included listings so profit cannot be inflated by unknown cost.
      if (!identity || !priceYen || !externalId || Number(item.availability) !== 1 || Number(item.postageFlag) !== 0) continue;
      result.push(observation({ source: "rakuten", externalId, title, priceYen, ...identity, capturedAt, raw: item, url: typeof item.itemUrl === "string" ? item.itemUrl : undefined, stockStatus: stockStatusFromQuantity(1) }));
    }
    return result;
  }
}
