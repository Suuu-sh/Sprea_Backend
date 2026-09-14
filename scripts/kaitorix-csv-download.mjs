import {gunzipSync} from "node:zlib";

const apiKey = process.env.KAITORIX_API_KEY?.trim();
const adminToken = process.env.SPREA_ADMIN_TOKEN?.trim();
const workerUrl = (process.env.SPREA_WORKER_URL ?? "https://sprea-research.suuu-sh.workers.dev").replace(/\/$/, "");
const baseUrl = "https://kaitorix.app";
const minProductPriceYen = Math.max(0, Number(process.env.KAITORIX_MIN_PRODUCT_PRICE_YEN ?? 5_000));
const maxStoresPerProduct = Math.max(1, Math.min(5, Number(process.env.KAITORIX_MAX_STORES_PER_PRODUCT ?? 2)));
const maxCandidates = Math.max(1, Number(process.env.KAITORIX_MAX_CANDIDATES ?? 5_000));

if (!apiKey) throw new Error("KAITORIX_API_KEY is not configured");
if (!adminToken) throw new Error("SPREA_ADMIN_TOKEN is not configured");

const headers = {
  authorization: `Bearer ${apiKey}`,
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Sprea daily CSV sync)",
  origin: "https://sprea-frontend.pages.dev",
  referer: "https://sprea-frontend.pages.dev/",
};

async function jsonOrText(response) {
  try { return await response.json(); } catch { return await response.text(); }
}

async function requireOk(response, operation) {
  if (response.ok) return;
  const body = await jsonOrText(response);
  const detail = typeof body === "string" ? body.replace(/\s+/g, " ").slice(0, 160) : body?.error ?? body?.message ?? "";
  throw new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`);
}

function parseCsv(value) {
  const text = value.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) { row.push(field); if (row.some(cell => cell !== "")) rows.push(row); }
  return rows;
}

function money(value) {
  const normalized = String(value ?? "").replace(/[￥¥,\s]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function timestamp(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const result = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 9, Number(minute), Number(second)));
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

function category(value) {
  return ({"スマートフォン":"smartphone", "タブレット":"tablet", "ゲーム":"game_console", "ゲーム機":"game_console", "カメラ":"camera", "PC":"computer", "パソコン":"computer", "家電":"home_appliance", "オーディオ":"audio", "未分類":"other", "その他":"other"})[String(value ?? "").trim()] ?? null;
}

function condition(name) {
  if (/(未開封|新品)/u.test(name)) return "new";
  if (/未使用/u.test(name)) return "unused";
  if (/(中古|使用済|ジャンク|訳あり|欠品|箱なし)/u.test(name)) return "used";
  return "unknown";
}

const accessoryText = /(?:ケース|カバー|保護フィルム|ガラスフィルム|ストラップ|ケーブル|充電器|アダプタ|モバイルバッテリー|交換用|修理用|液晶パネル|レンズカバー|usb\s*メモリ|フラッシュドライブ|外付けドライブ|写真バックアップ|容量不足解消)/iu;

function extractCandidates(csv) {
  const rows = parseCsv(csv);
  if (!rows.length) return {candidates: [], rowsRead: 0, skippedRows: 0};
  const headers = rows[0].map(header => header.trim());
  const indexOf = new Map(headers.map((header, index) => [header, index]));
  const providers = headers.filter(header => !new Set(["jan", "name", "category", "msrp"]).has(header) && !header.endsWith("_取得日時"));
  const candidates = new Map();
  let skippedRows = 0;
  for (const row of rows.slice(1)) {
    const jan = String(row[indexOf.get("jan")] ?? "").trim();
    const productName = String(row[indexOf.get("name")] ?? "").trim();
    if (!/^\d{8,14}$/.test(jan) || !productName || ["used", "refurbished"].includes(condition(productName)) || accessoryText.test(productName)) { skippedRows += 1; continue; }
    const stores = [];
    for (const provider of providers) {
      const price = money(row[indexOf.get(provider)]);
      const fetchedAt = timestamp(row[indexOf.get(`${provider}_取得日時`)]);
      if (price && fetchedAt) stores.push({provider, price, fetchedAt});
    }
    if (!stores.length) { skippedRows += 1; continue; }
    stores.sort((left, right) => right.price - left.price);
    const msrp = money(row[indexOf.get("msrp")]);
    if (Math.max(msrp ?? 0, stores[0].price) < minProductPriceYen) { skippedRows += 1; continue; }
    const candidate = {jan, productName, category: category(row[indexOf.get("category")]), condition: condition(productName), ...(msrp ? {msrp} : {}), bestBuybackPrice: stores[0].price, bestBuybackProvider: stores[0].provider, storeCount: stores.length, stores: stores.slice(0, maxStoresPerProduct)};
    const previous = candidates.get(jan);
    if (!previous || candidate.bestBuybackPrice > previous.bestBuybackPrice) candidates.set(jan, candidate);
  }
  return {candidates: [...candidates.values()].sort((left, right) => right.bestBuybackPrice - left.bestBuybackPrice).slice(0, maxCandidates), rowsRead: rows.length - 1, skippedRows};
}

const statusResponse = await fetch(`${baseUrl}/api/data-export/today/status`, {headers});
await requireOk(statusResponse, "KaitoriX CSV status");
const status = await statusResponse.json();
if (status.has_addon === false) throw new Error("KaitoriX CSV download add-on is not enabled");

if (!status.generated_today) {
  const generate = await fetch(`${baseUrl}/api/data-export/today/generate`, {method: "POST", headers});
  if (!generate.ok && generate.status !== 409) await requireOk(generate, "KaitoriX CSV generation");
}

let download;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const response = await fetch(`${baseUrl}/api/data-export/today/download`, {headers: {...headers, accept: "application/gzip, application/octet-stream"}});
  if (response.ok) { download = response; break; }
  if (![404, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) await requireOk(response, "KaitoriX CSV download");
  const retryAfter = Number(response.headers.get("retry-after"));
  const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : response.status === 404 ? 2000 : 1000;
  await new Promise(resolve => setTimeout(resolve, waitMs));
}
if (!download) throw new Error("KaitoriX CSV download returned no response");

const bytes = new Uint8Array(await download.arrayBuffer());
if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("KaitoriX CSV download was not gzip data");
const date = /^\d{4}-\d{2}-\d{2}$/.test(status.today ?? "") ? status.today : new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Tokyo"}).format(new Date());
const upload = await fetch(`${workerUrl}/admin/kaitorix-csv/upload`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/gzip",
    "content-length": String(bytes.byteLength),
    "x-kaitorix-snapshot-date": date,
  },
  body: bytes,
});
await requireOk(upload, "Sprea CSV archive upload");
const result = await upload.json();
const extracted = extractCandidates(gunzipSync(bytes).toString("utf8"));
let imported = 0;
for (let index = 0; index < extracted.candidates.length || (index === 0 && extracted.candidates.length === 0); index += 500) {
  const batch = extracted.candidates.slice(index, index + 500);
  const response = await fetch(`${workerUrl}/admin/kaitorix-csv/import-candidates`, {
    method: "POST",
    headers: {authorization: `Bearer ${adminToken}`, "content-type": "application/json"},
    body: JSON.stringify({
      date,
      candidates: batch,
      replace: index === 0,
      rowsRead: extracted.rowsRead,
      totalCandidates: extracted.candidates.length,
      complete: index + batch.length >= extracted.candidates.length,
      bytes: bytes.byteLength,
      objectKey: result.objectKey,
    }),
  });
  await requireOk(response, "Sprea CSV candidate import");
  const importedBatch = await response.json();
  imported += Number(importedBatch.accepted ?? 0);
}
// Mark the durable provider queue for one rebuild immediately; the five-minute
// cron continues it in small batches and resumes after a failed request.
const discovery = await fetch(`${workerUrl}/api/research/discovery/run`, {method: "POST"});
if (!discovery.ok && discovery.status !== 202) await requireOk(discovery, "Sprea discovery queue start");
console.log(JSON.stringify({date, bytes: bytes.byteLength, objectKey: result.objectKey, status: result.status, rowsRead: extracted.rowsRead, candidates: extracted.candidates.length, imported}));
