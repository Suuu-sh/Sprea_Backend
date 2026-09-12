const apiKey = process.env.KAITORIX_API_KEY?.trim();
const adminToken = process.env.SPREA_ADMIN_TOKEN?.trim();
const workerUrl = (process.env.SPREA_WORKER_URL ?? "https://sprea-research.suuu-sh.workers.dev").replace(/\/$/, "");
const baseUrl = "https://kaitorix.app";

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
console.log(JSON.stringify({date, bytes: bytes.byteLength, objectKey: result.objectKey, status: result.status}));
