import type { ProviderResult } from './types';
import { fetchWithTimeout, num } from './http';
import { heliusLimiter } from './rate-limit';
import type {
  NormalizedDexTrade,
  TokenTradeQuery,
  TradeFeedProvider,
  WalletTradeQuery,
} from './trade-feed';

function heliusKey(): string | undefined {
  return process.env.HELIUS_API_KEY?.trim() || undefined;
}

function heliusBase(): string {
  return (
    process.env.HELIUS_API_URL?.replace(/\/$/, '') || 'https://api.helius.xyz'
  );
}

type HeliusTx = {
  signature?: string;
  timestamp?: number;
  type?: string;
  feePayer?: string;
  tokenTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    mint?: string;
    tokenAmount?: number;
  }>;
  nativeTransfers?: Array<{ fromUserAccount?: string; toUserAccount?: string; amount?: number }>;
};

export function mapHeliusSwap(
  tx: HeliusTx,
  wallet: string,
): NormalizedDexTrade[] {
  const sig = String(tx.signature ?? '');
  const ts = (tx.timestamp ?? 0) < 1e12 ? (tx.timestamp ?? 0) * 1000 : (tx.timestamp ?? 0);
  if (!sig || !ts) return [];
  const transfers = tx.tokenTransfers ?? [];
  const out: NormalizedDexTrade[] = [];
  for (const tr of transfers) {
    const mint = String(tr.mint ?? '');
    const amt = num(tr.tokenAmount) ?? 0;
    if (!mint || amt <= 0) continue;
    const isBuy = tr.toUserAccount === wallet;
    const isSell = tr.fromUserAccount === wallet;
    if (!isBuy && !isSell) continue;
    if (mint === 'So11111111111111111111111111111111111111112') continue;
    out.push({
      wallet,
      token: mint,
      type: isBuy ? 'buy' : 'sell',
      amount: amt,
      usdValue: 0,
      price: 0,
      marketCap: null,
      liquidity: null,
      timestamp: ts,
      txHash: sig,
      provider: 'helius',
    });
  }
  return out;
}

export class HeliusTradeProvider implements TradeFeedProvider {
  id = 'helius';

  enabled(): boolean {
    return Boolean(heliusKey());
  }

  async fetchTokenTrades(
    query: TokenTradeQuery,
  ): Promise<ProviderResult<NormalizedDexTrade[]>> {
    void query;
    return { ok: false, error: 'Helius is wallet-centric; use fetchWalletTrades' };
  }

  async fetchWalletTrades(
    query: WalletTradeQuery,
  ): Promise<ProviderResult<NormalizedDexTrade[]>> {
    const key = heliusKey();
    if (!key) {
      return { ok: false, error: 'HELIUS_API_KEY not set' };
    }
    try {
      await heliusLimiter.take();
      const url = `${heliusBase()}/v0/addresses/${encodeURIComponent(query.wallet)}/transactions?api-key=${encodeURIComponent(key)}&limit=${query.limit ?? 40}&type=SWAP`;
      const res = await fetchWithTimeout(url, {}, 12000);
      if (!res.ok) {
        return {
          ok: false,
          unavailable: res.status >= 500 || res.status === 429,
          error: `Helius HTTP ${res.status}`,
        };
      }
      const payload = (await res.json()) as HeliusTx[];
      const trades = (Array.isArray(payload) ? payload : []).flatMap((tx) =>
        mapHeliusSwap(tx, query.wallet),
      );
      return { ok: true, data: trades };
    } catch (err) {
      return {
        ok: false,
        unavailable: true,
        error: err instanceof Error ? err.message : 'Helius wallet trades failed',
      };
    }
  }
}
