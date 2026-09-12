import type {BuybackQuoteInput} from "./import-buyback-quotes";

const BASE_COLUMNS = new Set(["jan", "name", "category", "msrp"]);
const TIMESTAMP_SUFFIX = "_取得日時";

export type KaitorixCsvParseResult = {
  quotes: BuybackQuoteInput[];
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
