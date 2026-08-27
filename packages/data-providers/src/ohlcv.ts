import type { Candle, Timeframe } from '@memecoinbot/indicators';
import type { ProviderResult, SourceHealth } from './types';
import { fetchWithTimeout, num } from './http';

const DEFAULT_BASE = 'https://api.geckoterminal.com/api/v2';

function baseUrl(): string {
  return (
    process.env.GECKOTERMINAL_BASE_URL?.replace(/\/$/, '') || DEFAULT_BASE
  );
}

const TF_MAP: Record<
  Timeframe,
  { timeframe: 'minute' | 'hour' | 'day'; aggregate: number }
> = {
  '1m': { timeframe: 'minute', aggregate: 1 },
  '5m': { timeframe: 'minute', aggregate: 5 },
  '15m': { timeframe: 'minute', aggregate: 15 },
  '30m': { timeframe: 'minute', aggregate: 30 },
  '1h': { timeframe: 'hour', aggregate: 1 },
  '4h': { timeframe: 'hour', aggregate: 4 },
};

type CacheEntry = { expires: number; candles: Candle[] };
const ohlcvCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ProviderResult<Candle[]>>>();
/** Short enough that the forming 5m candle can move on screen. */
const CACHE_TTL_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function ohlcvCacheKey(poolAddress: string, timeframe: Timeframe): string {
  return `${poolAddress}:${timeframe}`;
}

export function sliceCandles(candles: Candle[], limit: number): Candle[] {
  if (limit <= 0 || candles.length <= limit) return candles;
  return candles.slice(-limit);
}

export async function resolvePoolAddress(
  tokenMint: string,
  preferredPair?: string | null,
): Promise<ProviderResult<string>> {
  if (preferredPair) {
    return { ok: true, data: preferredPair };
  }
  try {
    const url = `${baseUrl()}/networks/solana/tokens/${encodeURIComponent(tokenMint)}/pools?page=1`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) {
      return {
        ok: false,
        unavailable: res.status >= 500 || res.status === 429,
        error: `GeckoTerminal pools HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as {
      data?: Array<{ attributes?: { address?: string } }>;
    };
    const address = payload.data?.[0]?.attributes?.address;
    if (!address) {
      return { ok: false, error: 'No pool found for token' };
    }
    return { ok: true, data: address };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Pool lookup failed',
    };
  }
}

async function fetchOhlcvNetwork(
  poolAddress: string,
  timeframe: Timeframe,
  stale: Candle[] | undefined,
): Promise<ProviderResult<Candle[]>> {
  const cfg = TF_MAP[timeframe];
  const url =
    `${baseUrl()}/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/${cfg.timeframe}` +
    `?aggregate=${cfg.aggregate}&limit=120&currency=usd`;

  let lastError = 'OHLCV request failed';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(800 * attempt * attempt);
      }
      const res = await fetchWithTimeout(url, {}, 15000);
      if (res.status === 429) {
        lastError = 'OHLCV HTTP 429';
        if (stale?.length) {
          return { ok: true, data: stale };
        }
        continue;
      }
      if (!res.ok) {
        if (stale?.length) return { ok: true, data: stale };
        return {
          ok: false,
          unavailable: res.status >= 500,
          error: `OHLCV HTTP ${res.status}`,
        };
      }
      const payload = (await res.json()) as {
        data?: { attributes?: { ohlcv_list?: unknown[] } };
      };
      const list = payload.data?.attributes?.ohlcv_list ?? [];
      const candles: Candle[] = [];
      for (const row of list) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const time = num(row[0]);
        const open = num(row[1]);
        const high = num(row[2]);
        const low = num(row[3]);
        const close = num(row[4]);
        const volume = num(row[5]);
        if (
          time == null ||
          open == null ||
          high == null ||
          low == null ||
          close == null ||
          volume == null
        ) {
          continue;
        }
        candles.push({ time, open, high, low, close, volume });
      }
      candles.sort((a, b) => a.time - b.time);
      if (candles.length < 8) {
        if (stale?.length) return { ok: true, data: stale };
        return {
          ok: false,
          error: `Insufficient candles (${candles.length})`,
        };
      }
      ohlcvCache.set(ohlcvCacheKey(poolAddress, timeframe), {
        expires: Date.now() + CACHE_TTL_MS,
        candles,
      });
      return { ok: true, data: candles };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'OHLCV request failed';
    }
  }

  if (stale?.length) return { ok: true, data: stale };
  return {
    ok: false,
    unavailable: true,
    error: lastError,
  };
}

export async function fetchOhlcv(
  poolAddress: string,
  timeframe: Timeframe,
  limit = 120,
): Promise<ProviderResult<Candle[]>> {
  const cacheKey = ohlcvCacheKey(poolAddress, timeframe);
  const cached = ohlcvCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return { ok: true, data: sliceCandles(cached.candles, limit) };
  }

  const pending = inflight.get(cacheKey);
  if (pending) {
    const shared = await pending;
    if (shared.ok && shared.data) {
      return { ok: true, data: sliceCandles(shared.data, limit) };
    }
    return shared;
  }

  const request = fetchOhlcvNetwork(poolAddress, timeframe, cached?.candles);
  inflight.set(cacheKey, request);
  try {
    const result = await request;
    if (result.ok && result.data) {
      return { ok: true, data: sliceCandles(result.data, limit) };
    }
    return result;
  } finally {
    inflight.delete(cacheKey);
  }
}

export async function fetchTokenOhlcv(
  tokenMint: string,
  timeframe: Timeframe,
  preferredPair?: string | null,
  limit = 120,
): Promise<ProviderResult<{ poolAddress: string; candles: Candle[] }>> {
  const pool = await resolvePoolAddress(tokenMint, preferredPair);
  if (!pool.ok || !pool.data) {
    return {
      ok: false,
      unavailable: pool.unavailable,
      error: pool.error ?? 'Pool unavailable',
    };
  }
  const ohlcv = await fetchOhlcv(pool.data, timeframe, limit);
  if (!ohlcv.ok || !ohlcv.data) {
    return {
      ok: false,
      unavailable: ohlcv.unavailable,
      error: ohlcv.error ?? 'OHLCV unavailable',
    };
  }
  return {
    ok: true,
    data: { poolAddress: pool.data, candles: ohlcv.data },
  };
}

export async function pingGeckoTerminal(): Promise<SourceHealth> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(
      `${baseUrl()}/networks/solana/dexes?page=1`,
      {},
      5000,
    );
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { status: 'OFFLINE', message: `HTTP ${res.status}`, latencyMs };
    }
    return { status: 'ONLINE', latencyMs };
  } catch (err) {
    return {
      status: 'OFFLINE',
      message: err instanceof Error ? err.message : 'unreachable',
    };
  }
}
