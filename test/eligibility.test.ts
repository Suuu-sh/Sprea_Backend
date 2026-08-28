import {describe, expect, it} from "vitest";
import {isEligibleBuybackQuote, isEligibleRetailListing} from "../src/domain/eligibility";
import type {BuybackQuote} from "../src/domain/buyback-quote";
import type {RetailListing, StockStatus} from "../src/domain/retail-listing";

const retail = (overrides: Partial<RetailListing> = {}): RetailListing => ({
  id: "retail-1", provider: "fixture", productName: "Camera X", condition: "new",
  attributes: {}, price: 100_000, shippingFee: 0, fee: 0, reward: 0,
  stockStatus: "in_stock", purchasable: true,
  fetchedAt: "2026-08-29T00:00:00.000Z", lastSeenAt: "2026-08-29T00:00:00.000Z",
  ...overrides,
});

const buyback = (overrides: Partial<BuybackQuote> = {}): BuybackQuote => ({
  id: "buyback-1", provider: "fixture", sourceType: "manual", productName: "Camera X",
  condition: "new", attributes: {}, price: 110_000, shippingFee: 0, fee: 0,
  buybackStatus: "accepting",
  fetchedAt: "2026-08-29T00:00:00.000Z", lastSeenAt: "2026-08-29T00:00:00.000Z",
  ...overrides,
});

describe("isEligibleRetailListing", () => {
  it.each(["in_stock", "low_stock"] satisfies StockStatus[])("accepts new, purchasable %s listings", stockStatus => {
    expect(isEligibleRetailListing(retail({stockStatus}))).toBe(true);
  });
  it.each(["out_of_stock", "preorder", "unknown"] satisfies StockStatus[])("rejects %s listings", stockStatus => {
    expect(isEligibleRetailListing(retail({stockStatus}))).toBe(false);
  });
  it("rejects used listings", () => expect(isEligibleRetailListing(retail({condition: "used"}))).toBe(false));
  it("rejects non-purchasable listings", () => expect(isEligibleRetailListing(retail({purchasable: false}))).toBe(false));
});

describe("isEligibleBuybackQuote", () => {
  it("accepts new quotes that are accepting", () => expect(isEligibleBuybackQuote(buyback())).toBe(true));
  it.each(["paused", "unavailable", "unknown"] as const)("rejects %s quotes", buybackStatus => {
    expect(isEligibleBuybackQuote(buyback({buybackStatus}))).toBe(false);
  });
  it("rejects used quotes", () => expect(isEligibleBuybackQuote(buyback({condition: "used"}))).toBe(false));
});
