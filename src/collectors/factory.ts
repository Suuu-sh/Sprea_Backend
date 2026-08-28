import type { Collector } from "../types";
import { MockCollector } from "../mock-collector";
import { RakutenCollector } from "./rakuten";
import { YahooCollector } from "./yahoo";

export interface CollectorEnv {
  SPREA_ENV?: string;
  SPREA_COLLECTOR_SOURCE?: string;
  RAKUTEN_APPLICATION_ID?: string;
  RAKUTEN_ACCESS_KEY?: string;
  RAKUTEN_KEYWORD?: string;
  YAHOO_CLIENT_ID?: string;
  YAHOO_QUERY?: string;
}

export function collectorFromEnv(env: CollectorEnv): Collector {
  const source = env.SPREA_COLLECTOR_SOURCE ?? "mock";
  if (source === "mock") {
    if (env.SPREA_ENV === "production") throw new Error("Mock collection is disabled in production");
    return new MockCollector();
  }
  if (source === "rakuten") return new RakutenCollector({
    applicationId: env.RAKUTEN_APPLICATION_ID ?? "",
    accessKey: env.RAKUTEN_ACCESS_KEY ?? "",
    keyword: env.RAKUTEN_KEYWORD,
  });
  if (source === "yahoo") return new YahooCollector({ clientId: env.YAHOO_CLIENT_ID ?? "", query: env.YAHOO_QUERY });
  throw new Error(`Unsupported collector source: ${source}`);
}
