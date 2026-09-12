import sample from "./fixtures/kaitorix-sample.csv?raw";
import {describe, expect, it} from "vitest";
import {parseKaitorixCsv,parseKaitorixCsvCandidates} from "../src/application/kaitorix-csv";

describe("KaitoriX CSV parser", () => {
  it("expands each store price into a quote and preserves the daily snapshot time", () => {
    const result = parseKaitorixCsv(sample);

    expect(result.rowsRead).toBe(3);
    expect(result.skippedRows).toBe(0);
    expect(result.quotes).toHaveLength(6);

    const mario = result.quotes.find(quote => quote.jan === "4902370553031" && quote.price === 59000);
    expect(mario).toMatchObject({
      productName: "Nintendo Switch 2, マリオカート ワールド セット 未開封",
      category: "game_console",
      condition: "new",
      fetchedAt: "2026-09-13T00:02:00.000Z",
      attributes: {msrp: 53980, source: "kaitorix-csv"},
    });
    expect(mario?.provider).toBe("買取商店");
  });

  it("fails closed when the product condition is not explicit", () => {
    const result = parseKaitorixCsv(sample);
    const vr2 = result.quotes.find(quote => quote.jan === "4948872016490");
    expect(vr2?.condition).toBe("unknown");
  });

  it("skips a price when its timestamp is missing", () => {
    const result = parseKaitorixCsv(sample.replace("2026-09-13 09:02,2026-09-13 09:04", ",2026-09-13 09:04"));
    expect(result.quotes.some(quote => quote.jan === "4902370553031" && quote.provider === "買取商店")).toBe(false);
    expect(result.warnings.some(warning => warning.includes("買取商店の取得日時"))).toBe(true);
  });

  it("filters strict high-value candidates and keeps store summaries", () => {
    const result = parseKaitorixCsvCandidates(`${sample}\n4902370553048,Switch 2 ケース,ゲーム,12000,12000,,,2026-09-13 09:00,,`, {minProductPriceYen: 10000, maxStoresPerProduct: 2});
    expect(result.candidates).toHaveLength(2);
    const candidate = result.candidates.find(item => item.jan === "4902370553031");
    expect(candidate).toMatchObject({bestBuybackPrice: 59000, bestBuybackProvider: "買取商店", storeCount: 3});
    expect(candidate?.stores).toHaveLength(2);
    expect(result.candidates.some(item => item.productName.includes("ケース"))).toBe(false);
  });
});
