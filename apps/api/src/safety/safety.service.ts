import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  fetchDexScreenerToken,
  fetchGeckoToken,
  fetchMintAuthorities,
  fetchTokenSecurityReport,
  type TokenMarketSnapshot,
  type TokenSecurityReport,
} from '@memecoinbot/data-providers';
import { computeSafetyScore, type SafetyAnalysisResult } from '@memecoinbot/scoring';
import { PrismaService } from '../prisma/prisma.service';

export type TokenSafetyPayload = SafetyAnalysisResult & {
  address: string;
  securitySource: string | null;
  securityUnavailable: boolean;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  top10Pct: number | null;
  top20Pct: number | null;
  holderSampleCount: number | null;
  risks: Array<{ name: string; level: string; description?: string }>;
  beginner: {
    whatBotSees: string[];
    whatCouldGoWrong: string[];
    decision: string;
  };
};

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);
  private readonly cache = new Map<
    string,
    { at: number; payload: TokenSafetyPayload }
  >();
  private readonly cacheTtlMs = 60_000;
  private readonly inflight = new Map<string, Promise<TokenSafetyPayload>>();

  constructor(private readonly prisma: PrismaService) {}

  private cacheGet(address: string): TokenSafetyPayload | null {
    const hit = this.cache.get(address);
    if (!hit) return null;
    if (Date.now() - hit.at > this.cacheTtlMs) {
      this.cache.delete(address);
      return null;
    }
    return hit.payload;
  }

  private hasMarketContext(market?: Partial<TokenMarketSnapshot>): boolean {
    if (!market) return false;
    return (
      market.liquidityUsd != null ||
      market.volume24h != null ||
      market.buys24h != null ||
      market.pairAgeHours != null
    );
  }

  private async loadMarket(
    address: string,
  ): Promise<Partial<TokenMarketSnapshot> | undefined> {
    const dex = await fetchDexScreenerToken(address);
    if (dex.ok && dex.data) return dex.data;
    const gecko = await fetchGeckoToken(address);
    if (gecko.ok && gecko.data) return gecko.data;
    return undefined;
  }

  async analyzeAddress(
    address: string,
    market?: Partial<TokenMarketSnapshot>,
  ): Promise<TokenSafetyPayload> {
    const cached = this.cacheGet(address);
    if (cached) return cached;

    const pending = this.inflight.get(address);
    if (pending) return pending;

    const work = this.analyzeUncached(address, market);
    this.inflight.set(address, work);
    try {
      return await work;
    } finally {
      this.inflight.delete(address);
    }
  }

  /** Scanner-speed safety: full report if it returns quickly, otherwise market-only score. */
  async analyzeFast(
    address: string,
    market?: Partial<TokenMarketSnapshot>,
    timeoutMs = 4500,
  ): Promise<TokenSafetyPayload> {
    const cached = this.cacheGet(address);
    if (cached) return cached;
    const fallback = this.scoreFromMarket(address, market);
    const full = this.analyzeAddress(address, market).catch((err) => {
      this.logger.warn(
        `Fast safety fallback for ${address.slice(0, 8)}… (${err instanceof Error ? err.message : 'error'})`,
      );
      return fallback;
    });
    return Promise.race([
      full,
      new Promise<TokenSafetyPayload>((resolve) =>
        setTimeout(() => resolve(fallback), timeoutMs),
      ),
    ]);
  }

  private scoreFromMarket(
    address: string,
    market?: Partial<TokenMarketSnapshot>,
  ): TokenSafetyPayload {
    const analysis = computeSafetyScore({
      mintAuthorityRevoked: null,
      freezeAuthorityRevoked: null,
      liquidityUsd: market?.liquidityUsd ?? null,
      top10Pct: null,
      top20Pct: null,
      holderCount: null,
      buys24h: market?.buys24h ?? null,
      sells24h: market?.sells24h ?? null,
      volume24h: market?.volume24h ?? null,
      pairAgeHours: market?.pairAgeHours ?? null,
    });
    return {
      ...analysis,
      address,
      securitySource: null,
      securityUnavailable: true,
      mintAuthorityRevoked: null,
      freezeAuthorityRevoked: null,
      top10Pct: null,
      top20Pct: null,
      holderSampleCount: null,
      risks: [],
      beginner: this.buildBeginner(analysis, undefined, false, {
        mintAuthorityRevoked: null,
        freezeAuthorityRevoked: null,
      }),
    };
  }

  private async analyzeUncached(
    address: string,
    market?: Partial<TokenMarketSnapshot>,
  ): Promise<TokenSafetyPayload> {
    const resolvedMarket = this.hasMarketContext(market)
      ? market
      : ((await this.loadMarket(address)) ?? market);

    const [security, mintRpc] = await Promise.all([
      fetchTokenSecurityReport(address),
      fetchMintAuthorities(address),
    ]);

    const report = security.ok ? security.data : undefined;
    const merged = this.mergeAuthorities(report, mintRpc.ok ? mintRpc.data ?? null : null);

    const creatorBalancePct = this.estimateCreatorPct(report);

    const criticalFlags = [...(report?.criticalFlags ?? [])];
    if (
      report &&
      mintRpc.ok &&
      mintRpc.data &&
      ((report.mintAuthorityRevoked !== mintRpc.data.mintAuthorityRevoked &&
        mintRpc.data.mintAuthorityRevoked !== null) ||
        (report.freezeAuthorityRevoked !== mintRpc.data.freezeAuthorityRevoked &&
          mintRpc.data.freezeAuthorityRevoked !== null))
    ) {
      // Prefer RPC if it says authority is active
      if (mintRpc.data.mintAuthorityRevoked === false) {
        criticalFlags.push('RPC confirms mint authority is still active');
      }
      if (mintRpc.data.freezeAuthorityRevoked === false) {
        criticalFlags.push('RPC confirms freeze authority is still active');
      }
    }

    const analysis = computeSafetyScore({
      mintAuthorityRevoked: merged.mintAuthorityRevoked,
      freezeAuthorityRevoked: merged.freezeAuthorityRevoked,
      mutableMetadata: report?.mutableMetadata ?? null,
      liquidityUsd:
        resolvedMarket?.liquidityUsd ?? report?.totalMarketLiquidity ?? null,
      top10Pct: report?.top10Pct ?? null,
      top20Pct: report?.top20Pct ?? null,
      holderCount: report?.holderSampleCount ?? null,
      buys24h: resolvedMarket?.buys24h ?? null,
      sells24h: resolvedMarket?.sells24h ?? null,
      volume24h: resolvedMarket?.volume24h ?? null,
      pairAgeHours: resolvedMarket?.pairAgeHours ?? null,
      creatorBalancePct,
      dangerRiskCount: report?.dangerRiskCount ?? 0,
      warnRiskCount: report?.warnRiskCount ?? 0,
      criticalFlags,
    });

    const payload: TokenSafetyPayload = {
      ...analysis,
      address,
      securitySource: report?.source ?? null,
      securityUnavailable: !security.ok,
      mintAuthorityRevoked: merged.mintAuthorityRevoked,
      freezeAuthorityRevoked: merged.freezeAuthorityRevoked,
      top10Pct: report?.top10Pct ?? null,
      top20Pct: report?.top20Pct ?? null,
      holderSampleCount: report?.holderSampleCount ?? null,
      risks: (report?.risks ?? []).map((r) => ({
        name: r.name,
        level: r.level,
        description: r.description,
      })),
      beginner: this.buildBeginner(analysis, report, security.ok, merged),
    };

    await this.persistBestEffort(payload);
    this.cache.set(address, { at: Date.now(), payload });
    return payload;
  }

  async analyzeOrThrow(address: string): Promise<TokenSafetyPayload> {
    const result = await this.analyzeAddress(address);
    if (result.securityUnavailable && result.mintAuthorityRevoked === null) {
      throw new NotFoundException(
        'Safety data unavailable for this token (security provider + RPC failed)',
      );
    }
    return result;
  }

  private mergeAuthorities(
    report: TokenSecurityReport | undefined,
    rpc: { mintAuthorityRevoked: boolean | null; freezeAuthorityRevoked: boolean | null } | null,
  ): {
    mintAuthorityRevoked: boolean | null;
    freezeAuthorityRevoked: boolean | null;
  } {
    // Prefer the more conservative (unsafe) reading when sources disagree
    const mintCandidates = [
      report?.mintAuthorityRevoked,
      rpc?.mintAuthorityRevoked,
    ].filter((v): v is boolean => typeof v === 'boolean');
    const freezeCandidates = [
      report?.freezeAuthorityRevoked,
      rpc?.freezeAuthorityRevoked,
    ].filter((v): v is boolean => typeof v === 'boolean');

    return {
      mintAuthorityRevoked:
        mintCandidates.length === 0
          ? null
          : mintCandidates.every(Boolean),
      freezeAuthorityRevoked:
        freezeCandidates.length === 0
          ? null
          : freezeCandidates.every(Boolean),
    };
  }

  private estimateCreatorPct(report: TokenSecurityReport | undefined): number | null {
    if (!report?.creator || !report.topHolders.length) return null;
    const match = report.topHolders.find(
      (h) => h.owner === report.creator || h.address === report.creator,
    );
    return match ? match.pct : 0;
  }

  private buildBeginner(
    analysis: SafetyAnalysisResult,
    report: TokenSecurityReport | undefined,
    securityOk: boolean,
    merged: {
      mintAuthorityRevoked: boolean | null;
      freezeAuthorityRevoked: boolean | null;
    },
  ) {
    const whatBotSees: string[] = [];
    if (merged.mintAuthorityRevoked === true) {
      whatBotSees.push('Mint authority revoked (or not set)');
    } else if (merged.mintAuthorityRevoked === false) {
      whatBotSees.push('Mint authority still active');
    }
    if (merged.freezeAuthorityRevoked === true) {
      whatBotSees.push('Freeze authority revoked (or not set)');
    } else if (merged.freezeAuthorityRevoked === false) {
      whatBotSees.push('Freeze authority still active');
    }
    if (report?.top10Pct != null) {
      whatBotSees.push(
        `Top 10 holders ≈ ${report.top10Pct.toFixed(1)}% (${analysis.holderRisk} RISK)`,
      );
    }
    whatBotSees.push(`Safety score ${analysis.safetyScore}/100`);
    whatBotSees.push(`Whale activity: ${analysis.whaleActivity}`);
    if (!securityOk) {
      whatBotSees.push(
        'Security provider data partially/unavailable — scored conservatively',
      );
    }

    const whatCouldGoWrong = [
      'Meme coins are highly volatile.',
      'Liquidity can disappear quickly.',
      'Holder concentration can enable dumps.',
      'Security scans can miss novel exploits.',
      'This is not a guarantee of safety or profit.',
    ];

    return {
      whatBotSees,
      whatCouldGoWrong,
      decision:
        analysis.decision === 'NO_TRADE'
          ? 'NO TRADE'
          : 'POTENTIAL SETUP (filters only)',
    };
  }

  private async persistBestEffort(payload: TokenSafetyPayload): Promise<void> {
    void payload;
    return;
  }
}
