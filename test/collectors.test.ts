import { describe, expect, it, vi } from "vitest";
import { appleIdentity } from "../src/collectors/catalog";
import { RakutenCollector } from "../src/collectors/rakuten";
import { YahooCollector } from "../src/collectors/yahoo";
import { collectorFromEnv } from "../src/collectors/factory";

const at = new Date("2026-08-28T00:00:00.000Z");
const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), {
  status: 200, headers: { "content-type": "application/json" },
}));

describe("official marketplace collectors", () => {
  it("requires an exact Apple part number and capacity", () => {
    expect(appleIdentity("Apple iPhone 15 128GB MTP03J/A 新品")).toEqual({ manufacturerPartNumber: "MTP03J/A", model: "iPhone 15", capacity: "128GB" });
    expect(appleIdentity("Apple iPhone 15 128GB 中古 MTP03J/A")).toBeNull();
    expect(appleIdentity("Apple iPhone 15 128GB")).toBeNull();
  });

  it("normalizes only in-stock, postage-included Rakuten items", async () => {
    const fetch = reply({ items: [
      { itemCode: "shop:1", itemName: "Apple iPhone 15 128GB MTP03J/A", itemPrice: 100000, availability: 1, postageFlag: 0 },
      { itemCode: "shop:2", itemName: "Apple iPhone 15 128GB MTP03J/A", itemPrice: 99000, availability: 1, postageFlag: 1 },
    ] });
    const rows = await new RakutenCollector({ applicationId: "app", accessKey: "secret", fetch }).collect(at);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "rakuten", externalId: "shop:1", priceYen: 100000, shippingYen: 0, rewardYen: 0 });
    const [url, init] = (fetch.mock.calls as unknown as Array<[URL, RequestInit]>)[0];
    expect(String(url)).not.toContain("secret");
    expect((init as RequestInit).headers).toMatchObject({ accessKey: "secret" });
  });

  it("normalizes only new, in-stock, free-shipping Yahoo items", async () => {
    const fetch = reply({ hits: [
      { code: "shop_1", name: "Apple iPhone 15 128GB MTP03J/A", price: 100000, inStock: true, condition: "new", janCode: "4549995420000", shipping: { code: 2 } },
      { code: "shop_2", name: "Apple iPhone 15 128GB MTP03J/A", price: 99000, inStock: true, condition: "new", shipping: { code: 3 } },
    ] });
    const rows = await new YahooCollector({ clientId: "client", fetch }).collect(at);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "yahoo-shopping", externalId: "shop_1", gtin: "4549995420000", rewardYen: 0 });
  });

  it("fails closed on upstream errors", async () => {
    const fetch = vi.fn(async () => new Response("busy", { status: 429 }));
    await expect(new YahooCollector({ clientId: "client", fetch }).collect(at)).rejects.toThrow("429");
  });

  it("never enables mock collection in production", () => {
    expect(() => collectorFromEnv({ SPREA_ENV: "production", SPREA_COLLECTOR_SOURCE: "mock" })).toThrow("disabled");
    expect(() => collectorFromEnv({ SPREA_ENV: "production", SPREA_COLLECTOR_SOURCE: "rakuten" })).toThrow("credentials");
  });
});
