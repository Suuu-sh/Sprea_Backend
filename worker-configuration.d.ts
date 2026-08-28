interface Env {
  DB: D1Database;
  MODELS: R2Bucket;
  COLLECTOR_MODE: "disabled" | "mock" | "live";
  SPREA_ENV?: "local" | "production";
  SPREA_COLLECTOR_SOURCE?: "mock" | "yahoo" | "rakuten";
  YAHOO_CLIENT_ID?: string;
  YAHOO_QUERY?: string;
  RAKUTEN_APPLICATION_ID?: string;
  RAKUTEN_ACCESS_KEY?: string;
  RAKUTEN_KEYWORD?: string;
  ADMIN_TOKEN?: string;
  INGEST_API_KEY?: string;
  SPREA_INGEST_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
}
