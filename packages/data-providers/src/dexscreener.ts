import type {
  DexPairSnapshot,
  ProviderResult,
  SourceHealth,
  TokenMarketSnapshot,
} from './types';
import { fetchWithTimeout, num } from './http';

const DEFAULT_BASE = 'https://api.dexscreener.com';
const DEX_CDN = 'https://cdn.dexscreener.com/cms/images';

function baseUrl(): string {
  return process.env.DEXSCREENER_BASE_URL?.replace(/\/$/, '') || DEFAULT_BASE;
}

/** DexScreener sometimes returns a full URL, sometimes only a CMS image id. */
export function resolveDexImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  // boost/profile "icon" fields look like "Im_Si_AC4e8BjDzm"
  if (/^[\w.-]+$/.test(v) && v.length >= 6) {
    return `${DEX_CDN}/${v}?width=256&height=256&quality=90&format=auto`;
  }
  return null;
}

function firstImageUrl(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const url = resolveDexImageUrl(c);
    if (url) return url;
  }
  return null;
}

export function mapPairToSnapshot(pair: Record<string, unknown>): DexPairSnapshot {
  const baseToken = (pair.baseToken ?? {}) as Record<string, string>;
  const quoteToken = (pair.quoteToken ?? {}) as Record<string, string>;
  const liquidity = (pair.liquidity ?? {}) as Record<string, unknown>;
  const volume = (pair.volume ?? {}) as Record<string, unknown>;
  const priceChange = (pair.priceChange ?? {}) as Record<string, unknown>;
  const txns = (pair.txns ?? {}) as Record<string, Record<string, unknown>>;
  const h24 = txns.h24 ?? {};
  const createdAt = num(pair.pairCreatedAt);
  const pairAgeHours =
    createdAt && createdAt > 0
      ? Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60))
      : null;
  const info = (pair.info ?? {}) as Record<string, unknown>;
  const imageUrl = firstImageUrl(
    info.imageUrl,
    info.image,
    pair.imageUrl,
    pair.icon,
    info.openGraph,
  );

  return {
    chainId: String(pair.chainId ?? ''),
    dexId: String(pair.dexId ?? ''),
    pairAddress: String(pair.pairAddress ?? ''),
    url: pair.url ? String(pair.url) : undefined,
    imageUrl,
    baseToken: {
      address: String(baseToken.address ?? ''),
      name: String(baseToken.name ?? 'Unknown'),
      symbol: String(baseToken.symbol ?? '???'),
    },
    quoteToken: {
      address: String(quoteToken.address ?? ''),
      name: String(quoteToken.name ?? 'Unknown'),
      symbol: String(quoteToken.symbol ?? '???'),
    },
    priceUsd: num(pair.priceUsd),
    marketCap: num(pair.marketCap),
    fdv: num(pair.fdv),
    liquidityUsd: num(liquidity.usd),
    volume24h: num(volume.h24),
    volumeM5: num(volume.m5),
    volumeH1: num(volume.h1),
    priceChange24h: num(priceChange.h24),
    priceChangeM5: num(priceChange.m5),
    priceChangeH1: num(priceChange.h1),
    priceChangeH6: num(priceChange.h6),
    buys24h: num(h24.buys) !== null ? Math.trunc(num(h24.buys) as number) : null,
    sells24h: num(h24.sells) !== null ? Math.trunc(num(h24.sells) as number) : null,
    buysM5: num((txns.m5 ?? {}).buys) !== null ? Math.trunc(num((txns.m5 ?? {}).buys) as number) : null,
    sellsM5: num((txns.m5 ?? {}).sells) !== null ? Math.trunc(num((txns.m5 ?? {}).sells) as number) : null,
    pairCreatedAt: createdAt,
    pairAgeHours,
  };
}

export function pickBestSolanaPair(
  pairs: DexPairSnapshot[],
): DexPairSnapshot | null {
  const solana = pairs.filter((p) => p.chainId === 'solana' && p.baseToken.address);
  if (solana.length === 0) return null;
  return [...solana].sort((a, b) => {
    const img = Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl));
    if (img !== 0) return img;
    return (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0);
  })[0];
}

function toTokenSnapshot(pair: DexPairSnapshot): TokenMarketSnapshot {
  return {
    address: pair.baseToken.address,
    name: pair.baseToken.name,
    symbol: pair.baseToken.symbol,
    imageUrl: pair.imageUrl ?? null,
    priceUsd: pair.priceUsd,
    marketCap: pair.marketCap ?? pair.fdv,
    fdv: pair.fdv,
    liquidityUsd: pair.liquidityUsd,
    volume24h: pair.volume24h,
    volumeM5: pair.volumeM5,
    volumeH1: pair.volumeH1,
    priceChange24h: pair.priceChange24h,
    priceChangeM5: pair.priceChangeM5,
    priceChangeH1: pair.priceChangeH1,
    priceChangeH6: pair.priceChangeH6,
    buys24h: pair.buys24h,
    sells24h: pair.sells24h,
    buysM5: pair.buysM5,
    sellsM5: pair.sellsM5,
    pairAgeHours: pair.pairAgeHours,
    dexId: pair.dexId || null,
    pairAddress: pair.pairAddress || null,
    source: 'dexscreener',
    fetchedAt: new Date().toISOString(),
  };
}

/** Prefer the richest pair, but keep a logo from any twin pair for the same mint. */
function toTokenSnapshotWithLogo(pairs: DexPairSnapshot[]): TokenMarketSnapshot | null {
  const best = pickBestSolanaPair(pairs);
  if (!best) return null;
  const snap = toTokenSnapshot(best);
  if (snap.imageUrl) return snap;
  const withLogo = pairs.find(
    (p) =>
      p.chainId === 'solana' &&
      p.baseToken.address === best.baseToken.address &&
      p.imageUrl,
  );
  if (withLogo?.imageUrl) snap.imageUrl = withLogo.imageUrl;
  return snap;
}

async function parsePairsPayload(payload: unknown): Promise<DexPairSnapshot[]> {
  let list: unknown[] = [];
  if (Array.isArray(payload)) {
    list = payload;
  } else if (payload && typeof payload === 'object' && Array.isArray((payload as { pairs?: unknown[] }).pairs)) {
    list = (payload as { pairs: unknown[] }).pairs;
  }
  return list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(mapPairToSnapshot);
}

export async function fetchDexScreenerToken(
  address: string,
): Promise<ProviderResult<TokenMarketSnapshot>> {
  try {
    const url = `${baseUrl()}/tokens/v1/solana/${encodeURIComponent(address)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      return {
        ok: false,
        unavailable: res.status >= 500,
        error: `DEX Screener HTTP ${res.status}`,
      };
    }
    const pairs = await parsePairsPayload(await res.json());
    const snap = toTokenSnapshotWithLogo(pairs);
    if (!snap) {
      return { ok: false, error: 'No Solana pairs found for token' };
    }
    return { ok: true, data: snap };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'DEX Screener request failed',
    };
  }
}

export async function fetchDexScreenerSearch(
  query: string,
): Promise<ProviderResult<TokenMarketSnapshot[]>> {
  try {
    const url = `${baseUrl()}/latest/dex/search?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      return {
        ok: false,
        unavailable: res.status >= 500,
        error: `DEX Screener search HTTP ${res.status}`,
      };
    }
    const pairs = await parsePairsPayload(await res.json());
    const byAddress = new Map<string, TokenMarketSnapshot>();
    for (const pair of pairs.filter((p) => p.chainId === 'solana')) {
      const snap = toTokenSnapshot(pair);
      const existing = byAddress.get(snap.address);
      if (!existing) {
        byAddress.set(snap.address, snap);
        continue;
      }
      if ((snap.liquidityUsd ?? 0) > (existing.liquidityUsd ?? 0)) {
        byAddress.set(snap.address, {
          ...snap,
          imageUrl: snap.imageUrl ?? existing.imageUrl ?? null,
        });
      } else if (!existing.imageUrl && snap.imageUrl) {
        existing.imageUrl = snap.imageUrl;
      }
    }
    return { ok: true, data: [...byAddress.values()] };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'DEX Screener search failed',
    };
  }
}

/** Fresh Solana pairs from multi-query search (includes pair age). */
export async function discoverNewSolanaMarkets(
  limit = 40,
): Promise<ProviderResult<TokenMarketSnapshot[]>> {
  const queries = ['meme', 'AI', 'dog', 'cat', 'pump', 'pepe', 'sol'];
  try {
    const results = await Promise.all(
      queries.map((q) => fetchDexScreenerSearch(q)),
    );
    const byMint = new Map<string, TokenMarketSnapshot>();
    for (const result of results) {
      if (!result.ok || !result.data) continue;
      for (const snap of result.data) {
        const existing = byMint.get(snap.address);
        if (
          !existing ||
          (snap.volume24h ?? 0) > (existing.volume24h ?? 0) ||
          (Boolean(snap.imageUrl) && !existing.imageUrl)
        ) {
          byMint.set(snap.address, snap);
        }
      }
    }
    const ranked = [...byMint.values()].sort(
      (a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0),
    );
    if (!ranked.length) {
      return { ok: false, error: 'No Solana markets from DEX search' };
    }
    return { ok: true, data: ranked.slice(0, limit) };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'DEX market discovery failed',
    };
  }
}

export async function discoverSolanaTokenAddresses(
  limit = 20,
): Promise<ProviderResult<string[]>> {
  try {
    const [boostsRes, profilesRes] = await Promise.all([
      fetchWithTimeout(`${baseUrl()}/token-boosts/top/v1`),
      fetchWithTimeout(`${baseUrl()}/token-profiles/latest/v1`),
    ]);

    if (!boostsRes.ok && !profilesRes.ok) {
      return {
        ok: false,
        unavailable: true,
        error: 'DEX Screener discovery endpoints unavailable',
      };
    }

    const addresses: string[] = [];
    const seen = new Set<string>();

    const ingest = async (res: Response) => {
      if (!res.ok) return;
      const payload = (await res.json()) as Array<Record<string, unknown>>;
      if (!Array.isArray(payload)) return;
      for (const item of payload) {
        if (item.chainId !== 'solana') continue;
        const addr = String(item.tokenAddress ?? '');
        if (!addr || seen.has(addr)) continue;
        seen.add(addr);
        addresses.push(addr);
        if (addresses.length >= limit) break;
      }
    };

    await ingest(boostsRes);
    if (addresses.length < limit) {
      await ingest(profilesRes);
    }

    if (addresses.length === 0) {
      return { ok: false, error: 'No Solana tokens discovered' };
    }

    return { ok: true, data: addresses.slice(0, limit) };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Discovery failed',
    };
  }
}

export async function pingDexScreener(): Promise<SourceHealth> {
  const started = Date.now();
  try {
    // Prefer a lightweight search; token-boosts often hangs on some networks
    const res = await fetchWithTimeout(
      `${baseUrl()}/latest/dex/search?q=SOL`,
      {},
      6000,
    );
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        status: 'OFFLINE',
        message: `HTTP ${res.status}`,
        latencyMs,
      };
    }
    return { status: 'ONLINE', latencyMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unreachable';
    return {
      status: 'OFFLINE',
      message:
        msg.includes('abort') || msg.includes('Abort')
          ? 'Timed out — network may block api.dexscreener.com (scanner falls back to GeckoTerminal)'
          : msg,
    };
  }
}
