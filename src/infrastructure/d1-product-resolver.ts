import type {BuybackQuote, ProductCondition} from "../domain";
import {matchProduct, type ProductMatchCandidate, type ProductMatchResult, type ProductResolver} from "../application/product-resolver";

type ProductRow = {id: number | string; gtin: string | null; manufacturer_part_number: string | null; condition: string};

export class D1ProductResolver implements ProductResolver {
  constructor(private readonly db: D1Database) {}
  async resolve(quote: Pick<BuybackQuote, "jan" | "modelNumber" | "condition">): Promise<ProductMatchResult> {
    const rows = (await this.db.prepare(
      "SELECT id,gtin,manufacturer_part_number,condition FROM canonical_products WHERE (gtin IS NOT NULL AND gtin <> '') OR (manufacturer_part_number IS NOT NULL AND manufacturer_part_number <> '')",
    ).all<ProductRow>()).results;
    const candidates: ProductMatchCandidate[] = rows.map(row => ({
      id: String(row.id), jan: row.gtin, modelNumber: row.manufacturer_part_number, condition: row.condition as ProductCondition,
    }));
    return matchProduct(quote, candidates);
  }
}
