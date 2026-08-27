import type { ProviderResult } from './types';

export type TradeFeedKind = 'buy' | 'sell';

export type NormalizedDexTrade = {
  wallet: string;
  token: string;
  type: TradeFeedKind;
  amount: number;
  usdValue: number;
  price: number;
  marketCap: number | null;
  liquidity: number | null;
  timestamp: number;
  txHash: string;
  provider: string;
};

export type TokenTradeQuery = {
  mint: string;
  poolAddress?: string | null;
  symbol?: string;
  marketCap?: number | null;
  liquidity?: number | null;
  limit?: number;
};

export type WalletTradeQuery = {
  wallet: string;
  limit?: number;
};

export interface TradeFeedProvider {
  id: string;
  fetchTokenTrades(query: TokenTradeQuery): Promise<ProviderResult<NormalizedDexTrade[]>>;
  fetchWalletTrades?(query: WalletTradeQuery): Promise<ProviderResult<NormalizedDexTrade[]>>;
}

export function mergeTradeFeeds(results: NormalizedDexTrade[]): NormalizedDexTrade[] {
  const seen = new Set<string>();
  const out: NormalizedDexTrade[] = [];
  for (const t of results) {
    const key = `${t.txHash}:${t.wallet}:${t.type}:${t.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}
