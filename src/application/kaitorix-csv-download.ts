/**
 * KaitoriX's daily CSV export client.
 *
 * The CSV is kept compressed in the existing R2 bucket. It is intentionally
 * not expanded into one D1 row per store here: a 25k-product snapshot has
 * roughly 75k store quotes and doing that every day would recreate the D1
 * read/write exhaustion this application is designed to avoid.
 */

const KAITORIX_BASE_URL = "https://kaitorix.app";
const DOWNLOAD_ATTEMPTS = 3;

type Fetcher = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

type ExportStatus = {
  has_addon?: boolean;
  today?: string;
  generated_today?: boolean;
  file_size_bytes?: number | null;
  download_count?: number;
};

export type KaitorixCsvDownloadResult = {
  date: string;
  objectKey: string;
  bytes: number;
  generated: boolean;
};

type CsvArchiveEnv = {
  KAITORIX_API_KEY?: string;
  MODELS: R2Bucket;
};

const authHeaders = (apiKey: string): HeadersInit => ({
  authorization: `Bearer ${apiKey}`,
  accept: "application/json",
  // KaitoriX's edge protection rejects requests without a browser-compatible
  // user agent/origin even when the bearer key is valid.
  "user-agent": "Mozilla/5.0 (compatible; Sprea daily CSV sync)",
  origin: "https://sprea-frontend.pages.dev",
  referer: "https://sprea-frontend.pages.dev/",
});

const jstDate = (at: Date): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const responseError = async (response: Response, operation: string): Promise<Error> => {
  let detail = "";
  const copy = response.clone();
  try {
    const payload = await response.json() as { error?: unknown; message?: unknown };
    detail = typeof payload.error === "string" ? payload.error : typeof payload.message === "string" ? payload.message : "";
  } catch {
    try {
      const text = await copy.text();
      detail = text.replace(/\s+/g, " ").trim().slice(0, 160);
    } catch {
      // Keep the API key and response body out of logs when KaitoriX returns an unreadable response.
    }
  }
  return new Error(`${operation} failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
};

const waitForRetry = async (response: Response, sleeper: Sleep): Promise<void> => {
  const retryAfter = Number(response.headers.get("retry-after"));
  // The documented limit is one download per minute. In normal operation this
  // path is never reached; when it is, respect the server hint but cap the
  // wait so a Worker invocation cannot run indefinitely.
  const milliseconds = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1_000, 5_000)
    : response.status === 404 ? 2_000 : 1_000;
  await sleeper(milliseconds);
};

/** Generate (if needed), download, and archive today's KaitoriX CSV export. */
export async function downloadKaitorixCsv(
  env: CsvArchiveEnv,
  at = new Date(),
  fetcher: Fetcher = globalThis.fetch,
  sleeper: Sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
): Promise<KaitorixCsvDownloadResult> {
  const apiKey = env.KAITORIX_API_KEY?.trim();
  if (!apiKey) throw new Error("KaitoriX API key is not configured");

  const headers = authHeaders(apiKey);
  const statusResponse = await fetcher(`${KAITORIX_BASE_URL}/api/data-export/today/status`, { headers });
  if (!statusResponse.ok) throw await responseError(statusResponse, "KaitoriX CSV status");
  const status = await statusResponse.json() as ExportStatus;
  if (status.has_addon === false) throw new Error("KaitoriX CSV download add-on is not enabled");

  let generated = Boolean(status.generated_today);
  if (!generated) {
    const generateResponse = await fetcher(`${KAITORIX_BASE_URL}/api/data-export/today/generate`, {
      method: "POST",
      headers,
    });
    if (!generateResponse.ok && generateResponse.status !== 409) {
      throw await responseError(generateResponse, "KaitoriX CSV generation");
    }
    generated = generateResponse.ok;
  }

  let downloadResponse: Response | undefined;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    const response = await fetcher(`${KAITORIX_BASE_URL}/api/data-export/today/download`, {
      headers: { ...headers, accept: "application/gzip, application/octet-stream" },
    });
    if (response.ok) {
      downloadResponse = response;
      break;
    }
    if (![404, 429, 500, 502, 503, 504].includes(response.status) || attempt === DOWNLOAD_ATTEMPTS) {
      throw await responseError(response, "KaitoriX CSV download");
    }
    await waitForRetry(response, sleeper);
  }
  if (!downloadResponse) throw new Error("KaitoriX CSV download returned no response");

  const body = await downloadResponse.arrayBuffer();
  if (body.byteLength < 2 || new Uint8Array(body, 0, 2)[0] !== 0x1f || new Uint8Array(body, 0, 2)[1] !== 0x8b) {
    throw new Error("KaitoriX CSV download was not gzip data");
  }

  const date = jstDate(at);
  const objectKey = `kaitorix/csv/${date}.csv.gz`;
  await env.MODELS.put(objectKey, body, {
    httpMetadata: { contentType: "application/gzip", contentEncoding: "gzip" },
    customMetadata: {
      source: "kaitorix",
      snapshotDateJst: date,
      downloadedAt: at.toISOString(),
      generatedToday: String(generated),
    },
  });
  return { date, objectKey, bytes: body.byteLength, generated };
}

export { jstDate };
