import type {ProductAttributes} from "./product";

const colors: Array<[RegExp, string]> = [
  [/(?:ブラック|黒|black)/iu, "black"], [/(?:ホワイト|白|white)/iu, "white"],
  [/(?:ブルー|青|blue)/iu, "blue"], [/(?:レッド|赤|red)/iu, "red"],
  [/(?:グリーン|緑|green)/iu, "green"], [/(?:ピンク|桃|pink)/iu, "pink"],
  [/(?:シルバー|銀|silver)/iu, "silver"], [/(?:ゴールド|金|gold)/iu, "gold"],
  [/(?:グレー|灰|gray|grey)/iu, "gray"], [/(?:パープル|紫|purple)/iu, "purple"],
];
const salesPhrases = /(?:新品未開封|新品|未使用品?|送料無料|送料込み|即納|在庫あり|限定特価|セール|買取)/giu;

export function normalizeStorage(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(G|GB|T|TB)$/);
  if (!match) return text || undefined;
  return `${match[1]}${match[2].startsWith("T") ? "TB" : "GB"}`;
}

export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let text = value.normalize("NFKC").trim().toLowerCase();
  for (const [pattern, normalized] of colors) if (pattern.test(text)) return normalized;
  text = text.replace(/[\s\-_]+/g, " ").trim();
  return text || undefined;
}

export function normalizeModelNumber(value?: string | null): string {
  return value?.normalize("NFKC").toUpperCase().replace(/[\s\-_‐‑‒–—―]+/gu, "") ?? "";
}

export function normalizeProductName(value: string): string {
  let text = value.normalize("NFKC").toLowerCase().replace(salesPhrases, " ");
  text = text.replace(/(\d+(?:\.\d+)?)\s*(?:g|gb)\b/giu, "$1gb").replace(/(\d+(?:\.\d+)?)\s*(?:t|tb)\b/giu, "$1tb");
  for (const [pattern, normalized] of colors) text = text.replace(pattern, ` ${normalized} `);
  return text.replace(/[\[\]【】()（）{}「」『』<>＜＞,，.。・:：;；/\\|+＋=＝~〜!！?？"'`]/gu, " ")
    .replace(/[\-_‐‑‒–—―]+/gu, " ").replace(/\s+/g, " ").trim();
}

const normalizedText = (value: unknown): string | boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFKC").trim().toLowerCase().replace(/[\s\-_]+/g, " ");
  return text || undefined;
};

export function normalizeAttributes(attributes: ProductAttributes = {}): ProductAttributes {
  const result: ProductAttributes = {};
  const storage = normalizeStorage(attributes.storage);
  const color = normalizeColor(attributes.color);
  if (storage) result.storage = storage;
  if (color) result.color = color;
  for (const key of ["carrier", "edition", "kitType"] as const) {
    const value = normalizedText(attributes[key]); if (value !== undefined) result[key] = value;
  }
  if (typeof attributes.discDrive === "boolean") result.discDrive = attributes.discDrive;
  else if (typeof attributes.discDrive === "string") {
    const value = attributes.discDrive.normalize("NFKC").toLowerCase().trim();
    if (["true", "yes", "あり", "有", "搭載"].includes(value)) result.discDrive = true;
    if (["false", "no", "なし", "無", "非搭載"].includes(value)) result.discDrive = false;
  }
  return result;
}
