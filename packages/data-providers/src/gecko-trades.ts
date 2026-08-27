import type { ProviderResult } from './types';
import { fetchWithTimeout, num } from './http';
import { geckoLimiter } from './rate-limit';
import type { NormalizedDexTrade, TokenTradeQuery, TradeFeedProvider } from './trade-feed';

const DEFAULT_BASE = 'https://api.geckoterminal.com/api/v2';

function baseUrl(): string {
  return process.env.GECKOTERMINAL_BASE_URL?.replace(/\/$/, '') || DEFAULT_BASE;
}

export function mapGeckoTrade(
  item: Record<string, unknown>,
  query: TokenTradeQuery,
): NormalizedDexTrade | null {
  const attrs = (item.attributes ?? item) as Record<string, unknown>;
  const wallet = String(attrs.tx_from_address ?? attrs.from_address ?? '').trim();
  const txHash = String(attrs.tx_hash ?? item.id ?? '').trim();
  const kindRaw = String(attrs.kind ?? '').toLowerCase();
  const kind: 'buy' | 'sell' | null =
    kindRaw === 'buy' || kindRaw === 'sell'
      ? kindRaw
      : null;
  if (!wallet || !txHash || !kind) return null;
  const tsRaw = attrs.block_timestamp ?? attrs.timestamp;
  const timestamp =
    typeof tsRaw === 'number'
      ? tsRaw < 1e12
        ? tsRaw * 1000
        : tsRaw
      : Date.parse(String(tsRaw ?? '')) || 0;
  if (!timestamp) return null;
  const usd = num(attrs.volume_in_usd) ?? 0;
  const fromAmt = num(attrs.from_token_amount) ?? 0;
  const toAmt = num(attrs.to_token_amount) ?? 0;
  const tokenAmount = kind === 'buy' ? toAmt : fromAmt;
  const price =
    num(kind === 'buy' ? attrs.price_to_in_usd : attrs.price_from_in_usd) ??
    (tokenAmount > 0 ? usd / tokenAmount : 0);
  return {
    wallet,
    token: query.mint,
    type: kind,
    amount: tokenAmount,
    usdValue: usd,
    price,
    marketCap: query.marketCap ?? null,
    liquidity: query.liquidity ?? null,
    timestamp,
    txHash,
    provider: 'geckoterminal',
  };
}

export class GeckoTerminalTradeProvider implements TradeFeedProvider {
  id = 'geckoterminal';

  async fetchTokenTrades(
    query: TokenTradeQuery,
  ): Promise<ProviderResult<NormalizedDexTrade[]>> {
    const pool = query.poolAddress?.trim();
    if (!pool) {
      return { ok: false, error: 'GeckoTerminal trades require a pool address' };
    }
    try {
      await geckoLimiter.take();
      const url = `${baseUrl()}/networks/solana/pools/${encodeURIComponent(pool)}/trades?trade_volume_in_usd_greater_than=1`;
      const res = await fetchWithTimeout(url, {}, 12000);
      if (!res.ok) {
        return {
          ok: false,
          unavailable: res.status >= 500 || res.status === 429,
          error: `GeckoTerminal trades HTTP ${res.status}`,
        };
      }
      const payload = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const trades = (payload.data ?? [])
        .map((item) => mapGeckoTrade(item, query))
        .filter((t): t is NormalizedDexTrade => !!t)
        .slice(0, query.limit ?? 80);
      return { ok: true, data: trades };
    } catch (err) {
      return {
        ok: false,
        unavailable: true,
        error: err instanceof Error ? err.message : 'GeckoTerminal trades failed',
      };
    }
  }
}
