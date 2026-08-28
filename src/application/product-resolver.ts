import type {BuybackQuote, ProductCondition} from "../domain";

export type ProductMatchResult =
  | {matched: true; productId: string; confidence: number; reason: "jan_exact" | "model_exact"}
  | {matched: false; confidence: 0; reason: "unresolved"};

export type ProductMatchCandidate = {
  id: string;
  jan?: string | null;
  modelNumber?: string | null;
  condition: ProductCondition;
};

export interface ProductResolver {
  resolve(quote: Pick<BuybackQuote, "jan" | "modelNumber" | "condition">): Promise<ProductMatchResult>;
}

export const normalizeJan = (value?: string | null): string => value?.trim() ?? "";
export const normalizeModelNumber = (value?: string | null): string =>
  value?.normalize("NFKC").toUpperCase().replace(/[\s\-_‐‑‒–—―]+/gu, "") ?? "";

export function conditionsCompatible(left: ProductCondition, right: ProductCondition): boolean {
  if (left === right) return left !== "unknown";
  return (left === "new" && right === "unused") || (left === "unused" && right === "new");
}

export function matchProduct(
  quote: Pick<BuybackQuote, "jan" | "modelNumber" | "condition">,
  candidates: ProductMatchCandidate[],
): ProductMatchResult {
  const jan = normalizeJan(quote.jan);
  if (jan) {
    const match = candidates.find(candidate => normalizeJan(candidate.jan) === jan);
    if (match) return {matched: true, productId: match.id, confidence: 1, reason: "jan_exact"};
  }
  const model = normalizeModelNumber(quote.modelNumber);
  if (model) {
    const match = candidates.find(candidate =>
      normalizeModelNumber(candidate.modelNumber) === model
      && conditionsCompatible(quote.condition, candidate.condition));
    if (match) return {matched: true, productId: match.id, confidence: 0.99, reason: "model_exact"};
  }
  return {matched: false, confidence: 0, reason: "unresolved"};
}
