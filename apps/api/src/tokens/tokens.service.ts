import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  comparePrices,
  discoverNewSolanaMarkets,
  discoverSolanaTokensFromGecko,
  fetchAxiomToken,
  fetchDexScreenerSearch,
  fetchDexScreenerToken,
  fetchGeckoSearch,
  fetchGeckoToken,
  fetchJupiterPrice,
  fetchTokenOhlcv,
  getTokenDecimals,
  type ProviderResult,
  type TokenMarketSnapshot,
} from '@memecoinbot/data-providers';
import { isTimeframe, type Candle, type Timeframe } from '@memecoinbot/indicators';
import { isNewCoinAge } from '@memecoinbot/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService, type TokenSafetyPayload } from '../safety/safety.service';

export type ScannerToken = TokenMarketSnapshot & {
  axiomUnavailable: boolean;
  axiomScore: number | null;
  jupiterPriceUsd: number | null;
  dataConflict: boolean;
  conflictReason?: string;
  safetyScore: number | null;
  safetyDecision: 'POTENTIAL_SETUP' | 'NO_TRADE' | null;
  signalType: 'WATCH' | 'SETUP_FORMING' | 'NO_TRADE' | 'BUY' | null;
  criticalWarning: boolean;
  holderRisk: string | null;
  whaleActivity: string | null;
  safetySummary: string | null;
  feedSources?: string;
};

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  /** Skip DEX Screener for a short window after a hard timeout (common on blocked networks). */
  private dexCooldownUntil = 0;
  private lastScan: {
    items: ScannerToken[];
    source: string;
    note?: string;
    at: number;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly safetyService: SafetyService,
  ) {}

  private dexLikelyDown(): boolean {
    return Date.now() < this.dexCooldownUntil;
  }

  private markDexDown(error?: string) {
    const msg = error ?? '';
    if (msg.includes('abort') || msg.includes('Abort') || msg.includes('timed out')) {
      this.dexCooldownUntil = Date.now() + 5 * 60_000;
    }
  }

  private async fetchMarketToken(
    address: string,
  ): Promise<ProviderResult<TokenMarketSnapshot>> {
    if (!this.dexLikelyDown()) {
      const dex = await fetchDexScreenerToken(address);
      if (dex.ok && dex.data) return dex;
      this.markDexDown(dex.error);
      this.logger.warn(
        `DEX Screener miss for ${address.slice(0, 8)}… — trying GeckoTerminal (${dex.error ?? 'n/a'})`,
      );
    }
    return fetchGeckoToken(address);
  }

  private filterNewCoins(snapshots: TokenMarketSnapshot[]): TokenMarketSnapshot[] {
    return snapshots.filter((s) => isNewCoinAge(s.pairAgeHours));
  }

  private toListToken(snap: TokenMarketSnapshot): ScannerToken {
    return {
      ...snap,
      marketCap: snap.marketCap ?? snap.fdv,
      axiomUnavailable: true,
      axiomScore: null,
      jupiterPriceUsd: null,
      dataConflict: false,
      safetyScore: null,
      safetyDecision: null,
      signalType: null,
      criticalWarning: false,
      holderRisk: null,
      whaleActivity: null,
      safetySummary: null,
    };
  }

  private mergeSnaps(
    into: Map<string, TokenMarketSnapshot>,
    snaps: TokenMarketSnapshot[],
    ageFilter: boolean,
  ) {
    const list = ageFilter ? this.filterNewCoins(snaps) : snaps;
    for (const snap of list) {
      const existing = into.get(snap.address);
      if (!existing) {
        into.set(snap.address, { ...snap });
        continue;
      }
      if (!existing.imageUrl && snap.imageUrl) existing.imageUrl = snap.imageUrl;
      if ((snap.volume24h ?? 0) > (existing.volume24h ?? 0)) {
        existing.priceUsd = snap.priceUsd ?? existing.priceUsd;
        existing.volume24h = snap.volume24h ?? existing.volume24h;
        existing.liquidityUsd = snap.liquidityUsd ?? existing.liquidityUsd;
        existing.priceChange24h = snap.priceChange24h ?? existing.priceChange24h;
      }
    }
  }

  private scannerSignal(
    safety: {
      decision: 'POTENTIAL_SETUP' | 'NO_TRADE' | null;
      criticalWarning: boolean;
      safetyScore: number | null;
    } | null,
    snap: TokenMarketSnapshot,
  ): ScannerToken['signalType'] {
    if (!safety || safety.criticalWarning || safety.decision === 'NO_TRADE') {
      return 'NO_TRADE';
    }
    const score = safety.safetyScore ?? 0;
    const vol = snap.volume24h ?? 0;
    const liq = snap.liquidityUsd ?? 0;
    const chg = snap.priceChange24h ?? 0;
    if (score >= 75 && vol >= 15_000 && liq >= 10_000 && chg >= 8) {
      return 'SETUP_FORMING';
    }
    if (score >= 55) return 'WATCH';
    return 'NO_TRADE';
  }

  private async timed<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  private async enrichScanner(snap: TokenMarketSnapshot): Promise<ScannerToken> {
    const [jupiter, safety] = await Promise.all([
      this.timed(fetchJupiterPrice(snap.address, 6), 4000, null),
      this.safetyService.analyzeFast(snap.address, snap, 4500),
    ]);
    const jupiterPrice =
      jupiter && jupiter.ok && jupiter.data?.routeAvailable
        ? jupiter.data.priceUsd
        : null;
    const consensus = comparePrices(snap.priceUsd, jupiterPrice);
    return {
      ...snap,
      marketCap: snap.marketCap ?? snap.fdv,
      axiomUnavailable: true,
      axiomScore: null,
      jupiterPriceUsd: jupiterPrice,
      dataConflict: consensus.conflict,
      conflictReason: consensus.conflictReason,
      safetyScore: safety.safetyScore,
      safetyDecision: safety.decision,
      signalType: this.scannerSignal(safety, snap),
      criticalWarning: safety.criticalWarning,
      holderRisk: safety.holderRisk,
      whaleActivity: safety.whaleActivity,
      safetySummary: safety.summary,
    };
  }

  private cachedScan(note: string) {
    if (!this.lastScan?.items.length) return null;
    return {
      items: this.lastScan.items,
      source: this.lastScan.source,
      count: this.lastScan.items.length,
      note,
    };
  }

  async listTokens(params: {
    sort?: string;
    limit?: number;
    q?: string;
  }): Promise<{ items: ScannerToken[]; source: string; count: number; note?: string }> {
    const limit = Math.min(Math.max(params.limit ?? 15, 1), 30);
    const searching = Boolean(params.q?.trim());

    try {
      const merged = new Map<string, TokenMarketSnapshot>();
      let usedDex = false;
      let usedGecko = false;

      if (searching) {
        const q = params.q!.trim();
        const [dex, gecko] = await Promise.all([
          this.dexLikelyDown() ? Promise.resolve(null) : fetchDexScreenerSearch(q),
          fetchGeckoSearch(q),
        ]);
        if (dex?.ok && dex.data?.length) {
          usedDex = true;
          this.mergeSnaps(merged, dex.data, false);
        } else if (dex && !dex.ok) {
          this.markDexDown(dex.error);
        }
        if (gecko.ok && gecko.data?.length) {
          usedGecko = true;
          this.mergeSnaps(merged, gecko.data, false);
        }
      } else {
        const poolSize = Math.min(Math.max(limit * 8, 80), 150);
        const [markets, gecko] = await Promise.all([
          this.dexLikelyDown()
            ? Promise.resolve(null)
            : discoverNewSolanaMarkets(poolSize),
          discoverSolanaTokensFromGecko(Math.min(poolSize, 60)),
        ]);
        if (markets?.ok && markets.data?.length) {
          usedDex = true;
          this.mergeSnaps(merged, markets.data, true);
        } else if (markets && !markets.ok) {
          this.markDexDown(markets.error);
          this.logger.warn(
            `DEX Screener market discovery failed (${markets.error ?? 'n/a'})`,
          );
        }
        if (gecko.ok && gecko.data?.length) {
          usedGecko = true;
          this.mergeSnaps(merged, gecko.data, true);
        } else if (!gecko.ok) {
          this.logger.warn(`GeckoTerminal discovery failed (${gecko.error ?? 'n/a'})`);
        }
      }

      if (!merged.size && !usedDex && !usedGecko) {
        const cached = this.cachedScan(
          'Live feed is busy — showing last saved coins.',
        );
        if (cached) return cached;
        throw new ServiceUnavailableException('Token discovery unavailable');
      }

      const source =
        usedDex && usedGecko
          ? 'dexscreener/geckoterminal'
          : usedGecko
            ? 'geckoterminal'
            : 'dexscreener';

      const ranked = [...merged.values()]
        .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0) || (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
        .slice(0, Math.min(Math.max(limit * 3, 24), 45));

      const enriched: ScannerToken[] = [];
      const concurrency = 4;
      for (let i = 0; i < ranked.length; i += concurrency) {
        const batch = ranked.slice(i, i + concurrency);
        const rows = await Promise.all(
          batch.map(async (snap) => {
            try {
              const row = await this.enrichScanner(snap);
              return { ...row, feedSources: source };
            } catch (err) {
              this.logger.warn(
                `Scanner enrich skipped ${snap.address.slice(0, 8)}… (${err instanceof Error ? err.message : 'error'})`,
              );
              return { ...this.toListToken(snap), feedSources: source, signalType: 'WATCH' as const };
            }
          }),
        );
        enriched.push(...rows);
      }

      const sorted = this.sortTokens(enriched, params.sort ?? 'safety').slice(0, limit);

      if (!sorted.length) {
        const cached = this.cachedScan(
          'No live 1 min–30 day coins right now — showing last saved list.',
        );
        if (cached) return cached;
      }

      const payload = {
        items: sorted,
        source,
        count: sorted.length,
        note: searching
          ? undefined
          : 'Showing 1 min–30 day coins. Scam / honeypot flags are ranked last. Search by mint to look up any coin.',
      };
      if (sorted.length) {
        this.lastScan = { ...payload, at: Date.now() };
      }
      return payload;
    } catch (err) {
      const cached = this.cachedScan(
        'Live feed is busy — showing last saved coins.',
      );
      if (cached) return cached;
      throw err;
    }
  }

  async getToken(address: string): Promise<ScannerToken & { safety: TokenSafetyPayload }> {
    const market = await this.fetchMarketToken(address);
    if (!market.ok || !market.data) {
      throw new NotFoundException(market.error ?? 'Token not found');
    }

    const safety = await this.safetyService.analyzeAddress(address, market.data);
    const item = await this.enrichOne(market.data, false);
    const merged: ScannerToken & { safety: TokenSafetyPayload } = {
      ...item,
      safetyScore: safety.safetyScore,
      safetyDecision: safety.decision,
      signalType: this.scannerSignal(safety, market.data),
      criticalWarning: safety.criticalWarning,
      holderRisk: safety.holderRisk,
      whaleActivity: safety.whaleActivity,
      safetySummary: safety.summary,
      safety,
    };
    await this.persistBestEffort([merged]);
    return merged;
  }

  async getOhlcv(
    address: string,
    opts?: { timeframe?: string; limit?: number; pairAddress?: string },
  ): Promise<{
    address: string;
    timeframe: Timeframe;
    poolAddress: string;
    candles: Candle[];
    count: number;
  }> {
    const timeframe: Timeframe = isTimeframe(opts?.timeframe)
      ? opts!.timeframe!
      : '5m';
    const limit = Math.min(Math.max(opts?.limit ?? 60, 20), 200);

    let preferredPair = opts?.pairAddress?.trim() || null;
    if (!preferredPair) {
      try {
        const market = await this.fetchMarketToken(address);
        preferredPair =
          market.ok && market.data?.pairAddress ? market.data.pairAddress : null;
      } catch {
        preferredPair = null;
      }
    }

    const ohlcv = await fetchTokenOhlcv(address, timeframe, preferredPair, limit);
    if (!ohlcv.ok || !ohlcv.data) {
      throw new ServiceUnavailableException(
        ohlcv.error ?? 'OHLCV unavailable for this token',
      );
    }

    return {
      address,
      timeframe,
      poolAddress: ohlcv.data.poolAddress,
      candles: ohlcv.data.candles,
      count: ohlcv.data.candles.length,
    };
  }

  private async enrichMany(
    snapshots: TokenMarketSnapshot[],
    includeSafety: boolean,
  ): Promise<ScannerToken[]> {
    const concurrency = 3;
    const out: ScannerToken[] = [];
    for (let i = 0; i < snapshots.length; i += concurrency) {
      const batch = snapshots.slice(i, i + concurrency);
      const enriched = await Promise.all(
        batch.map((snap) => this.enrichOne(snap, includeSafety)),
      );
      out.push(...enriched);
    }
    return out;
  }

  private async enrichOne(
    snap: TokenMarketSnapshot,
    includeSafety: boolean,
  ): Promise<ScannerToken> {
    const decimalsResult = await getTokenDecimals(snap.address);
    const decimals = decimalsResult.ok ? decimalsResult.data : undefined;

    const [jupiter, axiom, safety] = await Promise.all([
      fetchJupiterPrice(snap.address, decimals ?? 6),
      fetchAxiomToken(snap.address),
      includeSafety
        ? this.safetyService.analyzeAddress(snap.address, snap)
        : Promise.resolve(null),
    ]);

    const jupiterPrice =
      jupiter.ok && jupiter.data?.routeAvailable && decimalsResult.ok
        ? jupiter.data.priceUsd
        : null;

    const consensus = comparePrices(snap.priceUsd, jupiterPrice);

    return {
      ...snap,
      marketCap: snap.marketCap ?? snap.fdv,
      axiomUnavailable: !axiom.ok,
      axiomScore: null,
      jupiterPriceUsd: jupiterPrice,
      dataConflict: consensus.conflict,
      conflictReason: consensus.conflictReason,
      safetyScore: safety?.safetyScore ?? null,
      safetyDecision: safety?.decision ?? null,
      signalType: this.scannerSignal(safety, snap),
      criticalWarning: safety?.criticalWarning ?? false,
      holderRisk: safety?.holderRisk ?? null,
      whaleActivity: safety?.whaleActivity ?? null,
      safetySummary: safety?.summary ?? null,
    };
  }

  private sortTokens(items: ScannerToken[], sort: string): ScannerToken[] {
    const copy = [...items];
    const bySort = (() => {
      switch (sort) {
        case 'liquidity':
          return copy.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
        case 'marketCap':
          return copy.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
        case 'priceChange':
          return copy.sort((a, b) => (b.priceChange24h ?? 0) - (a.priceChange24h ?? 0));
        case 'volume':
          return copy.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
        case 'safety':
        default:
          return copy.sort((a, b) => (b.safetyScore ?? -1) - (a.safetyScore ?? -1));
      }
    })();
    return bySort.sort((a, b) => {
      const scamA = a.criticalWarning ? 1 : 0;
      const scamB = b.criticalWarning ? 1 : 0;
      if (scamA !== scamB) return scamA - scamB;
      const liqA = (a.liquidityUsd ?? 0) < 8_000 ? 1 : 0;
      const liqB = (b.liquidityUsd ?? 0) < 8_000 ? 1 : 0;
      return liqA - liqB;
    });
  }

  private async persistBestEffort(items: ScannerToken[]): Promise<void> {
    // Market snapshots stay live/API-sourced; user data persists in Mongo.
    void items;
    void this.prisma;
  }
}
