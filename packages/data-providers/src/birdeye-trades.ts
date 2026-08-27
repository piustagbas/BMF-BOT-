import type { ProviderResult } from './types';
import { fetchWithTimeout, num } from './http';
import { birdeyeLimiter } from './rate-limit';
import type { NormalizedDexTrade, TokenTradeQuery, TradeFeedProvider } from './trade-feed';

function birdeyeKey(): string | undefined {
  return process.env.BIRDEYE_API_KEY?.trim() || undefined;
}

function birdeyeBase(): string {
  return process.env.BIRDEYE_API_URL?.replace(/\/$/, '') || 'https://public-api.birdeye.so';
}

export function mapBirdeyeTx(
  item: Record<string, unknown>,
  query: TokenTradeQuery,
): NormalizedDexTrade | null {
  const wallet = String(item.owner ?? item.txFrom ?? item.from ?? '').trim();
  const txHash = String(item.txHash ?? item.tx_hash ?? item.signature ?? '').trim();
  const side = String(item.side ?? item.txType ?? item.type ?? '').toLowerCase();
  const kind: 'buy' | 'sell' | null = side.includes('buy')
    ? 'buy'
    : side.includes('sell')
      ? 'sell'
      : null;
  if (!wallet || !txHash || !kind) return null;
  const ts = num(item.blockUnixTime ?? item.block_unix_time ?? item.unixTime) ?? 0;
  const timestamp = ts < 1e12 ? ts * 1000 : ts;
  if (!timestamp) return null;
  const usd = num(item.volumeUSD ?? item.volume_usd ?? item.volume) ?? 0;
  const amount = num(item.tokenAmount ?? item.amount) ?? 0;
  const price = num(item.priceUsd ?? item.price) ?? (amount > 0 ? usd / amount : 0);
  return {
    wallet,
    token: query.mint,
    type: kind,
    amount,
    usdValue: usd,
    price,
    marketCap: query.marketCap ?? num(item.marketCap) ?? null,
    liquidity: query.liquidity ?? null,
    timestamp,
    txHash,
    provider: 'birdeye',
  };
}

export class BirdeyeTradeProvider implements TradeFeedProvider {
  id = 'birdeye';

  enabled(): boolean {
    return Boolean(birdeyeKey());
  }

  async fetchTokenTrades(
    query: TokenTradeQuery,
  ): Promise<ProviderResult<NormalizedDexTrade[]>> {
    const key = birdeyeKey();
    if (!key) return { ok: false, error: 'BIRDEYE_API_KEY not set' };
    try {
      await birdeyeLimiter.take();
      const url = `${birdeyeBase()}/defi/txs/token?address=${encodeURIComponent(query.mint)}&tx_type=swap&limit=${query.limit ?? 50}&sort_type=desc`;
      const res = await fetchWithTimeout(
        url,
        { headers: { 'X-API-KEY': key, 'x-chain': 'solana' } },
        12000,
      );
      if (!res.ok) {
        return {
          ok: false,
          unavailable: res.status >= 500 || res.status === 429,
          error: `Birdeye HTTP ${res.status}`,
        };
      }
      const payload = (await res.json()) as {
        data?: { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      };
      const items = Array.isArray(payload.data)
        ? payload.data
        : payload.data?.items ?? [];
      const trades = items
        .map((item) => mapBirdeyeTx(item, query))
        .filter((t): t is NormalizedDexTrade => !!t);
      return { ok: true, data: trades };
    } catch (err) {
      return {
        ok: false,
        unavailable: true,
        error: err instanceof Error ? err.message : 'Birdeye trades failed',
      };
    }
  }
}
