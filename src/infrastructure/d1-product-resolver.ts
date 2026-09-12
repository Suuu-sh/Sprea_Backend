import type {BuybackQuote, ProductCondition} from "../domain";
import {matchProduct, type ProductMatchCandidate, type ProductMatchResult, type ProductResolver} from "../application/product-resolver";

type ProductRow = {id: number | string; gtin: string | null; manufacturer_part_number: string | null; title:string; brand:string; category:string; capacity:string; color:string; variant:string; condition: string};

export class D1ProductResolver implements ProductResolver {
  constructor(private readonly db: D1Database) {}

  /**
   * Product matching is performed for every quote in an ingest batch.  Keep
   * the canonical catalogue query lazy and shared for the lifetime of this
   * resolver so one batch never scans canonical_products once per quote.
   */
  private candidatesPromise?: Promise<ProductMatchCandidate[]>;

  private candidates(): Promise<ProductMatchCandidate[]> {
    if (!this.candidatesPromise) {
      this.candidatesPromise = this.db.prepare(
        "SELECT id,gtin,manufacturer_part_number,title,brand,category,capacity,color,variant,condition FROM canonical_products",
      ).all<ProductRow>().then(({results}) => results.map(row => ({
        id: String(row.id), jan: row.gtin, modelNumber: row.manufacturer_part_number, productName: row.title,
        brand: row.brand, category: row.category as ProductMatchCandidate["category"],
        attributes: {storage: row.capacity, color: row.color, edition: row.variant},
        condition: row.condition as ProductCondition,
      }))).catch(error => {
        // Do not retain a rejected promise. A transient D1 failure can be
        // retried by the caller without recreating the resolver instance.
        this.candidatesPromise = undefined;
        throw error;
      });
    }
    return this.candidatesPromise;
  }

  async resolve(quote: Pick<BuybackQuote, "jan" | "modelNumber" | "productName" | "brand" | "category" | "attributes" | "condition">): Promise<ProductMatchResult> {
    return matchProduct(quote, await this.candidates());
  }
}
