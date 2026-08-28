import type {BuybackQuote} from "../domain";

export interface BuybackQuoteRepository {
  upsertLatest(quote: BuybackQuote): Promise<void>;
  findLatestByProductId(productId: string): Promise<BuybackQuote[]>;
  findLatestByJan(jan: string): Promise<BuybackQuote[]>;
  findLatestByProvider(provider: string): Promise<BuybackQuote[]>;
}
