import type { ProviderResult } from './types';
import { BirdeyeTradeProvider } from './birdeye-trades';
import { GeckoTerminalTradeProvider } from './gecko-trades';
import { HeliusTradeProvider } from './helius-trades';
import {
  mergeTradeFeeds,
  type NormalizedDexTrade,
  type TokenTradeQuery,
  type TradeFeedProvider,
  type WalletTradeQuery,
} from './trade-feed';

export class CompositeTradeFeed implements TradeFeedProvider {
  id = 'composite';

  constructor(private readonly providers: TradeFeedProvider[]) {}

  async fetchTokenTrades(
    query: TokenTradeQuery,
  ): Promise<ProviderResult<NormalizedDexTrade[]>> {
    const errors: string[] = [];
    const collected: NormalizedDexTrade[] = [];
    for (const p of this.providers) {
      const res = await p.fetchTokenTrades(query);
      if (res.ok && res.data?.length) {
        collected.push(...res.data);
        if (collected.length >= (query.limit ?? 40)) break;
      } else if (!res.ok && res.error) {
        errors.push(`${p.id}: ${res.error}`);
      }
    }
    if (collected.length) {
      return { ok: true, data: mergeTradeFeeds(collected).slice(-(query.limit ?? 80)) };
    }
    return {
      ok: false,
      unavailable: true,
      error: errors.join('; ') || 'No trade feed returned data',
    };
  }

  async fetchWalletTrades(
    query: WalletTradeQuery,
  ): Promise<ProviderResult<NormalizedDexTrade[]>> {
    for (const p of this.providers) {
      if (!p.fetchWalletTrades) continue;
      const res = await p.fetchWalletTrades(query);
      if (res.ok && res.data) return res;
    }
    return { ok: false, error: 'No wallet trade provider available' };
  }
}

export function defaultTradeFeed(): CompositeTradeFeed {
  const providers: TradeFeedProvider[] = [];
  const birdeye = new BirdeyeTradeProvider();
  const helius = new HeliusTradeProvider();
  if (birdeye.enabled()) providers.push(birdeye);
  providers.push(new GeckoTerminalTradeProvider());
  if (helius.enabled()) providers.push(helius);
  return new CompositeTradeFeed(providers);
}
