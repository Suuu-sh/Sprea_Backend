import type {BuybackQuote, ProductAttributes, ProductCategory, ProductCondition} from "../domain";
import {normalizeAttributes, normalizeModelNumber, normalizeProductName} from "../domain";

export type ProductMatchResult =
  | {matched: true; productId: string; matchedProductId: string; confidence: number; reason: "jan_exact" | "model_exact" | "model_attributes" | "name_attributes"}
  | {matched: false; confidence: 0; reason: "unresolved"};

export type ProductMatchCandidate = {
  id: string;
  jan?: string | null;
  modelNumber?: string | null;
  productName?: string | null;
  brand?: string | null;
  category?: ProductCategory | null;
  attributes?: ProductAttributes;
  condition: ProductCondition;
};

export interface ProductResolver {
  resolve(quote: Pick<BuybackQuote, "jan" | "modelNumber" | "productName" | "brand" | "category" | "attributes" | "condition">): Promise<ProductMatchResult>;
}

export const normalizeJan = (value?: string | null): string => value?.trim() ?? "";
export {normalizeModelNumber};

export function conditionsCompatible(left: ProductCondition, right: ProductCondition): boolean {
  if (left === right) return left !== "unknown";
  return (left === "new" && right === "unused") || (left === "unused" && right === "new");
}

export function matchProduct(
  quote: Pick<BuybackQuote, "jan" | "modelNumber" | "productName" | "brand" | "category" | "attributes" | "condition">,
  candidates: ProductMatchCandidate[],
): ProductMatchResult {
  const jan = normalizeJan(quote.jan);
  if (jan) {
    const match = candidates.find(candidate => normalizeJan(candidate.jan) === jan);
    if (match) return {matched: true, productId: match.id, matchedProductId: match.id, confidence: 1, reason: "jan_exact"};
  }
  const model = normalizeModelNumber(quote.modelNumber);
  if (model) {
    const matches = candidates.filter(candidate =>
      normalizeModelNumber(candidate.modelNumber) === model
      && conditionsCompatible(quote.condition, candidate.condition));
    if (matches.length === 1) return {matched: true, productId: matches[0].id, matchedProductId: matches[0].id, confidence: 0.99, reason: "model_exact"};
    const byAttributes = uniqueAttributeMatch(quote, matches, true);
    if (byAttributes) return {matched: true, productId: byAttributes.id, matchedProductId: byAttributes.id, confidence: 0.97, reason: "model_attributes"};
  }
  const name = normalizeProductName(quote.productName ?? "");
  if (name && quote.category) {
    const byName = candidates.filter(candidate => normalizeProductName(candidate.productName ?? "") === name
      && candidate.category === quote.category && conditionsCompatible(quote.condition, candidate.condition));
    const match = uniqueAttributeMatch(quote, byName);
    if (match) return {matched: true, productId: match.id, matchedProductId: match.id, confidence: 0.95, reason: "name_attributes"};
  }
  return {matched: false, confidence: 0, reason: "unresolved"};
}

function uniqueAttributeMatch(quote: Pick<BuybackQuote, "attributes" | "brand" | "category">, candidates: ProductMatchCandidate[], requireIdentity=false): ProductMatchCandidate | undefined {
  const expected = normalizeAttributes(quote.attributes);
  const entries = Object.entries(expected);
  if (!entries.length) return undefined;
  const brand = quote.brand?.normalize("NFKC").trim().toLowerCase();
  if (requireIdentity && (!brand || !quote.category)) return undefined;
  const matches = candidates.filter(candidate => {
    if (brand && candidate.brand?.normalize("NFKC").trim().toLowerCase() !== brand) return false;
    if (quote.category && candidate.category !== quote.category) return false;
    const actual = normalizeAttributes(candidate.attributes);
    return entries.every(([key, value]) => actual[key] === value);
  });
  return matches.length === 1 ? matches[0] : undefined;
}
