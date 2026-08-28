import type {BuybackQuote, ProductCondition} from "../domain";
import {matchProduct, type ProductMatchCandidate, type ProductMatchResult, type ProductResolver} from "../application/product-resolver";

type ProductRow = {id: number | string; gtin: string | null; manufacturer_part_number: string | null; title:string; brand:string; category:string; capacity:string; color:string; variant:string; condition: string};

export class D1ProductResolver implements ProductResolver {
  constructor(private readonly db: D1Database) {}
  async resolve(quote: Pick<BuybackQuote, "jan" | "modelNumber" | "productName" | "brand" | "category" | "attributes" | "condition">): Promise<ProductMatchResult> {
    const rows = (await this.db.prepare(
      "SELECT id,gtin,manufacturer_part_number,title,brand,category,capacity,color,variant,condition FROM canonical_products",
    ).all<ProductRow>()).results;
    const candidates: ProductMatchCandidate[] = rows.map(row => ({
      id: String(row.id), jan: row.gtin, modelNumber: row.manufacturer_part_number, productName:row.title,
      brand:row.brand, category:row.category as ProductMatchCandidate["category"],
      attributes:{storage:row.capacity,color:row.color,edition:row.variant}, condition: row.condition as ProductCondition,
    }));
    return matchProduct(quote, candidates);
  }
}
