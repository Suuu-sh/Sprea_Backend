import type { ListingObservation } from "../types";
import type { StockStatus } from "../domain";

/** Shared, conservative normalization for official marketplace APIs. */
export function appleIdentity(title: string): { manufacturerPartNumber: string; model: string; capacity: string } | null {
  const normalized = title.normalize("NFKC");
  if (!/\b(?:Apple|iPhone|iPad|AirPods|MacBook|Apple Watch)\b/i.test(normalized)) return null;
  if (/(?:中古|整備済|リファービッシュ|ジャンク|開封済|展示品)/i.test(normalized)) return null;

  // Japanese Apple part numbers normally look like MTP03J/A. Requiring the part
  // number prevents a broad title match from merging different colors/variants.
  const model = normalized.match(/\b([A-Z][A-Z0-9]{3,9}J\/A)\b/i)?.[1]?.toUpperCase();
  const capacity = normalized.match(/\b(64|128|256|512)\s*GB\b/i)?.[1]
    ?? normalized.match(/\b([124])\s*TB\b/i)?.[1];
  if (!model || !capacity) return null;
  const capacityGb = /TB/i.test(normalized.match(/\b[124]\s*TB\b/i)?.[0] ?? "") ? Number(capacity) * 1024 : Number(capacity);
  const family = normalized.match(/\b(iPhone\s+\d+(?:\s+(?:Pro(?:\s+Max)?|Plus|mini))?|iPad(?:\s+(?:Air|Pro|mini))?|MacBook\s+(?:Air|Pro)|AirPods(?:\s+Pro)?|Apple\s+Watch)\b/i)?.[1];
  if (!family) return null;
  return { manufacturerPartNumber: model, model: family, capacity: `${capacityGb}GB` };
}

export function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function observation(input: {
  source: string; externalId: string; title: string; priceYen: number;
  gtin?: string; manufacturerPartNumber: string; model: string; capacity: string; capturedAt: string; raw: unknown; url?: string;
  stockStatus?: StockStatus;
}): ListingObservation {
  return {
    ...input,
    side: "purchase",
    shippingYen: 0,
    feeYen: 0,
    // API point figures can depend on campaign/login state, so v1 deliberately
    // treats them as non-guaranteed rather than overstating market profit.
    rewardYen: 0,
    stock: 1,
    condition: "new",
    stockStatus: input.stockStatus ?? "in_stock",
    purchasable: Boolean(input.url),
  };
}
