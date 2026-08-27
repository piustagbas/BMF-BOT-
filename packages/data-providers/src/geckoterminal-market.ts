import type { ProviderResult, TokenMarketSnapshot } from './types';
import { fetchWithTimeout, num } from './http';

const DEFAULT_BASE = 'https://api.geckoterminal.com/api/v2';

function baseUrl(): string {
  return (
    process.env.GECKOTERMINAL_BASE_URL?.replace(/\/$/, '') || DEFAULT_BASE
  );
}

function mintFromGeckoId(id: string | undefined): string | null {
  if (!id) return null;
  // ids look like "solana_<mint>"
  const parts = id.split('_');
  if (parts.length < 2) return null;
  return parts.slice(1).join('_');
}

function snapshotFromPool(pool: {
  attributes?: Record<string, unknown>;
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
}): TokenMarketSnapshot | null {
  const attrs = pool.attributes ?? {};
  const address = mintFromGeckoId(pool.relationships?.base_token?.data?.id);
  if (!address) return null;

  const nameRaw = String(attrs.name ?? 'Unknown');
  const symbol = nameRaw.split('/')[0]?.trim() || '???';
  const volume = (attrs.volume_usd ?? {}) as Record<string, unknown>;
  const change = (attrs.price_change_percentage ?? {}) as Record<string, unknown>;
  const txns = (attrs.transactions ?? {}) as Record<string, Record<string, unknown>>;
  const h24 = txns.h24 ?? {};
  const createdAt = attrs.pool_created_at
    ? Date.parse(String(attrs.pool_created_at))
    : NaN;
  const pairAgeHours = Number.isFinite(createdAt)
    ? Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60))
    : null;
  const dexId = pool.relationships?.dex?.data?.id
    ? String(pool.relationships.dex.data.id).replace(/^solana_/, '')
    : null;

  return {
    address,
    name: symbol,
    symbol,
    imageUrl: typeof attrs.image_url === 'string' ? attrs.image_url : null,
    priceUsd: num(attrs.base_token_price_usd),
    marketCap: num(attrs.market_cap_usd) ?? num(attrs.fdv_usd),
    fdv: num(attrs.fdv_usd),
    liquidityUsd: num(attrs.reserve_in_usd),
    volume24h: num(volume.h24),
    volumeM5: num(volume.m5),
    volumeH1: num(volume.h1),
    priceChange24h: num(change.h24),
    priceChangeM5: num(change.m5),
    priceChangeH1: num(change.h1),
    priceChangeH6: num(change.h6),
    buys24h: num(h24.buys) !== null ? Math.trunc(num(h24.buys) as number) : null,
    sells24h: num(h24.sells) !== null ? Math.trunc(num(h24.sells) as number) : null,
    buysM5: num((txns.m5 ?? {}).buys) !== null ? Math.trunc(num((txns.m5 ?? {}).buys) as number) : null,
    sellsM5: num((txns.m5 ?? {}).sells) !== null ? Math.trunc(num((txns.m5 ?? {}).sells) as number) : null,
    pairAgeHours,
    dexId,
    pairAddress: attrs.address ? String(attrs.address) : null,
    source: 'geckoterminal',
    fetchedAt: new Date().toISOString(),
  };
}

export async function discoverSolanaTokensFromGecko(
  limit = 30,
): Promise<ProviderResult<TokenMarketSnapshot[]>> {
  try {
    const [trendingRes, trendingPage2Res, newRes] = await Promise.all([
      fetchWithTimeout(
        `${baseUrl()}/networks/solana/trending_pools?page=1`,
        {},
        12000,
      ),
      fetchWithTimeout(
        `${baseUrl()}/networks/solana/trending_pools?page=2`,
        {},
        12000,
      ),
      fetchWithTimeout(
        `${baseUrl()}/networks/solana/new_pools?page=1`,
        {},
        12000,
      ),
    ]);

    if (!trendingRes.ok && !trendingPage2Res.ok && !newRes.ok) {
      return {
        ok: false,
        unavailable:
          trendingRes.status >= 500 ||
          trendingRes.status === 429 ||
          trendingPage2Res.status >= 500 ||
          trendingPage2Res.status === 429 ||
          newRes.status >= 500 ||
          newRes.status === 429,
        error: `GeckoTerminal pools HTTP ${trendingRes.status}/${trendingPage2Res.status}/${newRes.status}`,
      };
    }

    const parse = async (res: Response) => {
      if (!res.ok) return [] as TokenMarketSnapshot[];
      const payload = (await res.json()) as {
        data?: Array<{
          attributes?: Record<string, unknown>;
          relationships?: {
            base_token?: { data?: { id?: string } };
            quote_token?: { data?: { id?: string } };
            dex?: { data?: { id?: string } };
          };
        }>;
      };
      return (payload.data ?? [])
        .map((p) => snapshotFromPool(p))
        .filter((x): x is TokenMarketSnapshot => !!x);
    };

    const [trending, trendingPage2, fresh] = await Promise.all([
      parse(trendingRes),
      parse(trendingPage2Res),
      parse(newRes),
    ]);

    const snapshots: TokenMarketSnapshot[] = [];
    const seen = new Set<string>();
    for (const snap of [...trending, ...trendingPage2, ...fresh]) {
      if (seen.has(snap.address)) continue;
      seen.add(snap.address);
      snapshots.push(snap);
      if (snapshots.length >= limit) break;
    }
    if (!snapshots.length) {
      return { ok: false, error: 'No Solana tokens from GeckoTerminal' };
    }
    return { ok: true, data: snapshots };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Gecko discovery failed',
    };
  }
}

export async function discoverSolanaTokenAddressesFromGecko(
  limit = 30,
): Promise<ProviderResult<string[]>> {
  const result = await discoverSolanaTokensFromGecko(limit);
  if (!result.ok || !result.data) {
    return {
      ok: false,
      unavailable: result.unavailable,
      error: result.error,
    };
  }
  return { ok: true, data: result.data.map((s) => s.address) };
}

export async function fetchGeckoToken(
  address: string,
): Promise<ProviderResult<TokenMarketSnapshot>> {
  try {
    const res = await fetchWithTimeout(
      `${baseUrl()}/networks/solana/tokens/${encodeURIComponent(address)}/pools?page=1`,
      {},
      12000,
    );
    if (!res.ok) {
      return {
        ok: false,
        unavailable: res.status >= 500 || res.status === 429,
        error: `GeckoTerminal token HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as {
      data?: Array<{
        attributes?: Record<string, unknown>;
        relationships?: {
          base_token?: { data?: { id?: string } };
          quote_token?: { data?: { id?: string } };
          dex?: { data?: { id?: string } };
        };
      }>;
    };
    const pools = payload.data ?? [];
    const snaps = pools
      .map((p) => snapshotFromPool(p))
      .filter((x): x is TokenMarketSnapshot => !!x)
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    const best = snaps[0];
    if (!best) {
      return { ok: false, error: 'No GeckoTerminal pools for token' };
    }
    // Prefer the requested mint as address
    return {
      ok: true,
      data: { ...best, address, fetchedAt: new Date().toISOString() },
    };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Gecko token fetch failed',
    };
  }
}

export async function fetchGeckoSearch(
  query: string,
): Promise<ProviderResult<TokenMarketSnapshot[]>> {
  try {
    const url =
      `${baseUrl()}/search/pools?query=${encodeURIComponent(query)}` +
      `&network=solana`;
    const res = await fetchWithTimeout(url, {}, 12000);
    if (!res.ok) {
      return {
        ok: false,
        unavailable: res.status >= 500 || res.status === 429,
        error: `GeckoTerminal search HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as {
      data?: Array<{
        attributes?: Record<string, unknown>;
        relationships?: {
          base_token?: { data?: { id?: string } };
          quote_token?: { data?: { id?: string } };
          dex?: { data?: { id?: string } };
        };
      }>;
    };
    const items = (payload.data ?? [])
      .map((p) => snapshotFromPool(p))
      .filter((x): x is TokenMarketSnapshot => !!x);
    // de-dupe by mint
    const seen = new Set<string>();
    const unique: TokenMarketSnapshot[] = [];
    for (const item of items) {
      if (seen.has(item.address)) continue;
      seen.add(item.address);
      unique.push(item);
    }
    return { ok: true, data: unique };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Gecko search failed',
    };
  }
}
