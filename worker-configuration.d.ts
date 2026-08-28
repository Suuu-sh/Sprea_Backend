interface Env {
  DB: D1Database;
  MODELS: R2Bucket;
  COLLECTOR_MODE: "disabled" | "mock";
  ADMIN_TOKEN?: string;
}
