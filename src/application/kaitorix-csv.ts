import type {BuybackQuoteInput} from "./import-buyback-quotes";

const BASE_COLUMNS = new Set(["jan", "name", "category", "msrp"]);
const TIMESTAMP_SUFFIX = "_取得日時";

export type KaitorixCsvParseResult = {
  quotes: BuybackQuoteInput[];
  rowsRead: number;
  skippedRows: number;
  warnings: string[];
};

export type KaitorixCsvStorePrice = {
  provider: string;
  price: number;
  fetchedAt: string;
};

/**
 * A compact, product-level representation used before writing a CSV snapshot
 * to D1.  Keeping only the best store and a small set of store summaries is
 * intentional: the original gzip is retained in R2, while D1 stores the
 * searchable subset needed by the retail discovery queue.
 */
export type KaitorixCsvCandidate = {
  jan: string;
  productName: string;
  category?: BuybackQuoteInput["category"];
  condition: "new" | "unused";
  msrp?: number;
  bestBuybackPrice: number;
  bestBuybackProvider: string;
  storeCount: number;
  stores: KaitorixCsvStorePrice[];
};

export type KaitorixCsvCandidateParseOptions = {
  /** Minimum product/buyback value considered worth a +3,000 yen search. */
  minProductPriceYen?: number;
  /** Number of store prices retained in the compact D1 projection. */
  maxStoresPerProduct?: number;
};

export type KaitorixCsvCandidateParseResult = {
  candidates: KaitorixCsvCandidate[];
  rowsRead: number;
  skippedRows: number;
  warnings: string[];
};

const parseCsv = (value: string): string[][] => {
  const text = value.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(cell => cell !== "")) rows.push(row);
  }
  return rows;
};

const parseMoney = (value: string | undefined): number | undefined => {
  if (!value?.trim()) return undefined;
  const normalized = value.replace(/[￥¥,\s]/g, "");
  if (!/^\d+$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
};

const parseJstTimestamp = (value: string | undefined): string | undefined => {
  if (!value?.trim()) return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 9, Number(minute), Number(second));
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const category = (value: string | undefined): BuybackQuoteInput["category"] => {
  switch (value?.trim()) {
    case "スマートフォン": return "smartphone";
    case "タブレット": return "tablet";
    case "ゲーム":
    case "ゲーム機": return "game_console";
    case "カメラ": return "camera";
    case "PC":
    case "パソコン": return "computer";
    case "家電": return "home_appliance";
    case "オーディオ": return "audio";
    case "未分類":
    case "その他": return "other";
    default: return undefined;
  }
};

const condition = (name: string): BuybackQuoteInput["condition"] => {
  if (/(未開封|新品)/.test(name)) return "new";
  if (/未使用/.test(name)) return "unused";
  if (/(中古|使用済)/.test(name)) return "used";
  return "unknown";
};

const accessoryText = /(?:ケース|カバー|保護フィルム|ガラスフィルム|ストラップ|ケーブル|充電器|アダプタ|モバイルバッテリー|交換用|修理用|液晶パネル|レンズカバー|usb\s*メモリ|フラッシュドライブ|外付けドライブ|写真バックアップ|容量不足解消)/iu;

const validJan = (value: string | undefined): value is string => Boolean(value && /^\d{8,14}$/.test(value));

/**
 * Filter a daily snapshot down to strict, high-value candidates.  This is
 * deliberately separate from `parseKaitorixCsv`: callers that need a full
 * quote expansion can keep using the original parser, while the production
 * sync can stay within D1's write budget.
 */
export function parseKaitorixCsvCandidates(
  csv: string,
  options: KaitorixCsvCandidateParseOptions = {},
): KaitorixCsvCandidateParseResult {
  const rows = parseCsv(csv);
  if (rows.length < 1) return {candidates: [], rowsRead: 0, skippedRows: 0, warnings: []};

  const minProductPriceYen = Math.max(0, Math.floor(options.minProductPriceYen ?? 5_000));
  const maxStoresPerProduct = Math.max(1, Math.min(5, Math.floor(options.maxStoresPerProduct ?? 2)));
  const headers = rows[0].map(header => header.trim());
  const providers = headers.filter(header => !BASE_COLUMNS.has(header) && !header.endsWith(TIMESTAMP_SUFFIX));
  const timestampHeaders = new Map(providers.map(provider => [provider, `${provider}${TIMESTAMP_SUFFIX}`]));
  const indexOf = new Map(headers.map((header, index) => [header, index]));
  const candidates: KaitorixCsvCandidate[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;

  for (const [rowIndex, row] of rows.slice(1).entries()) {
    const line = rowIndex + 2;
    const jan = row[indexOf.get("jan") ?? -1]?.trim();
    const productName = row[indexOf.get("name") ?? -1]?.trim();
    if (!validJan(jan) || !productName) {
      skippedRows += 1;
      warnings.push(`行${line}: JANまたは商品名が不正のためスキップ`);
      continue;
    }
    const productCondition = condition(productName);
    if (productCondition !== "new" && productCondition !== "unused") {
      skippedRows += 1;
      continue;
    }
    if (accessoryText.test(productName)) {
      skippedRows += 1;
      continue;
    }

    const stores: KaitorixCsvStorePrice[] = [];
    for (const provider of providers) {
      const price = parseMoney(row[indexOf.get(provider) ?? -1]);
      const fetchedAt = parseJstTimestamp(row[indexOf.get(timestampHeaders.get(provider)!) ?? -1]);
      if (price === undefined || !fetchedAt) continue;
      stores.push({provider, price, fetchedAt});
    }
    if (!stores.length) {
      skippedRows += 1;
      continue;
    }
    stores.sort((left, right) => right.price - left.price);
    const msrp = parseMoney(row[indexOf.get("msrp") ?? -1]);
    const best = stores[0];
    if (Math.max(msrp ?? 0, best.price) < minProductPriceYen) {
      skippedRows += 1;
      continue;
    }
    candidates.push({
      jan,
      productName,
      category: category(row[indexOf.get("category") ?? -1]),
      condition: productCondition,
      ...(msrp === undefined ? {} : {msrp}),
      bestBuybackPrice: best.price,
      bestBuybackProvider: best.provider,
      storeCount: stores.length,
      stores: stores.slice(0, maxStoresPerProduct),
    });
  }

  // A JAN must occur once in the queue.  If a malformed export contains a
  // duplicate row, keep the row with the strongest buyback price.
  const byJan = new Map<string, KaitorixCsvCandidate>();
  for (const candidate of candidates) {
    const previous = byJan.get(candidate.jan);
    if (!previous || candidate.bestBuybackPrice > previous.bestBuybackPrice) byJan.set(candidate.jan, candidate);
  }
  return {candidates: [...byJan.values()], rowsRead: rows.length - 1, skippedRows, warnings};
}

/** Convert a KaitoriX daily snapshot into one quote per store and product. */
export function parseKaitorixCsv(csv: string): KaitorixCsvParseResult {
  const rows = parseCsv(csv);
  if (rows.length < 1) return {quotes: [], rowsRead: 0, skippedRows: 0, warnings: []};

  const headers = rows[0].map(header => header.trim());
  const providers = headers.filter(header => !BASE_COLUMNS.has(header) && !header.endsWith(TIMESTAMP_SUFFIX));
  const timestampHeaders = new Map(providers.map(provider => [provider, `${provider}${TIMESTAMP_SUFFIX}`]));
  const indexOf = new Map(headers.map((header, index) => [header, index]));
  const quotes: BuybackQuoteInput[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;

  for (const [rowIndex, row] of rows.slice(1).entries()) {
    const line = rowIndex + 2;
    const jan = row[indexOf.get("jan") ?? -1]?.trim();
    const productName = row[indexOf.get("name") ?? -1]?.trim();
    if (!jan || !productName) {
      skippedRows += 1;
      warnings.push(`行${line}: janまたはnameが空のためスキップ`);
      continue;
    }

    const msrp = parseMoney(row[indexOf.get("msrp") ?? -1]);
    let rowQuotes = 0;
    for (const provider of providers) {
      const price = parseMoney(row[indexOf.get(provider) ?? -1]);
      if (price === undefined) continue;
      const fetchedAt = parseJstTimestamp(row[indexOf.get(timestampHeaders.get(provider)!) ?? -1]);
      if (!fetchedAt) {
        warnings.push(`行${line}: ${provider}の取得日時が不正または空のためスキップ`);
        continue;
      }
      quotes.push({
        provider,
        externalId: `${jan}:${provider}:${fetchedAt}`,
        productName,
        jan,
        category: category(row[indexOf.get("category") ?? -1]),
        condition: condition(productName),
        attributes: {msrp, source: "kaitorix-csv"},
        price,
        shippingFee: 0,
        fee: 0,
        buybackStatus: "accepting",
        fetchedAt,
      });
      rowQuotes += 1;
    }
    if (rowQuotes === 0) {
      skippedRows += 1;
      warnings.push(`行${line}: 有効な店舗価格がないためスキップ`);
    }
  }

  return {quotes, rowsRead: rows.length - 1, skippedRows, warnings};
}
