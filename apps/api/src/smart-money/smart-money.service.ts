import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  defaultTradeFeed,
  discoverNewSolanaMarkets,
  discoverSolanaTokensFromGecko,
  fetchDexScreenerToken,
  fetchGeckoToken,
  fetchTokenOhlcv,
  type TokenMarketSnapshot,
} from '@memecoinbot/data-providers';
import { DISCOVERY_DEFAULTS, WalletTier, looksLikeSolanaAddress } from '@memecoinbot/shared';
import {
  backtestWallet,
  classifyWallet,
  computeMemeCoinScore,
  computeWalletStats,
  decayedSmartScore,
  detectConsensus,
  evaluateExclusions,
  extraInfrastructureAddresses,
  formatSmartMoneyAlert,
  isKnownInfrastructure,
  scoreWallet,
  tierInfluence,
  tierLabel,
  type DexTrade,
  type ScoredWallet,
} from '@memecoinbot/smart-money';
import {
  DiscoveredWallet,
  MemeSignal,
  TrackedToken,
  WalletTransaction,
  isDbConnected,
} from '@memecoinbot/db';
import { buildIndicatorSnapshot } from '@memecoinbot/indicators';
import { scoreTechnicalFromSnapshot } from '@memecoinbot/scoring';
import { SafetyService } from '../safety/safety.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmartMoneyMemoryStore, type DashboardWallet } from './memory-store';

function shortLabel(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

@Injectable()
export class SmartMoneyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SmartMoneyService.name);
  private readonly store = new SmartMoneyMemoryStore();
  private readonly feed = defaultTradeFeed();
  private cycleTimer: ReturnType<typeof setInterval> | null = null;
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly alerted = new Map<string, number>();

  constructor(
    private readonly safety: SafetyService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (process.env.SMART_MONEY_DISCOVERY_ENABLED === 'false') {
      this.logger.log('Smart-money discovery disabled');
      return;
    }
    this.firstTimer = setTimeout(() => void this.runCycle(), 40_000);
    this.cycleTimer = setInterval(() => void this.runCycle(), 3 * 60_000);
    this.logger.log('Smart-money discovery armed (first cycle in 40s, then every 3m)');
  }

  onModuleDestroy() {
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
  }

  status() {
    const wallets = [...this.store.wallets.values()];
    return {
      lastCycle: this.store.lastCycle,
      lastError: this.store.lastError,
      wallets: wallets.length,
      tierA: wallets.filter((w) => w.tier === WalletTier.A && !w.excluded).length,
      tierB: wallets.filter((w) => w.tier === WalletTier.B && !w.excluded).length,
      trades: this.store.trades.length,
      tracked: this.trackedWallets().length,
      provider: this.feed.id,
    };
  }

  listWallets(sort: string = 'smartScore'): DashboardWallet[] {
    const rows = [...this.store.wallets.values()].filter((w) => !w.excluded || sort === 'all');
    const key = sort as keyof DashboardWallet;
    return rows.sort((a, b) => {
      if (sort === 'recent') {
        return (b.lastActive ?? '').localeCompare(a.lastActive ?? '');
      }
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') return bv - av;
      return b.smartScore - a.smartScore;
    });
  }

  getWallet(address: string) {
    const dash = this.store.wallets.get(address);
    const scored = this.store.scored.get(address);
    const trades = this.store.tradesForWallet(address).slice(-80);
    const bt = trades.length ? backtestWallet(address, this.store.trades) : null;
    return { wallet: dash, scored, trades, backtest: bt };
  }

  listSignals(limit = 30) {
    return this.store.signals.slice(0, limit);
  }

  trackedWallets(): Array<{ address: string; label: string }> {
    return [...this.store.wallets.values()]
      .filter(
        (w) =>
          !w.excluded && (w.tier === WalletTier.A || w.tier === WalletTier.B) && w.influence > 0,
      )
      .sort((a, b) => b.smartScore - a.smartScore)
      .slice(0, DISCOVERY_DEFAULTS.maxTrackedWallets)
      .map((w) => ({ address: w.address, label: w.label || shortLabel(w.address) }));
  }

  getConsensus(token: string) {
    const wallets = [...this.store.scored.values()];
    const buys = this.store.recentBuys(token).map((t) => ({
      address: t.wallet,
      token: t.token,
      symbol: t.symbol,
      buyTime: t.timestamp,
      usdValue: t.usdValue,
      entryMarketCap: t.marketCap,
    }));
    return detectConsensus({ token, wallets, buys });
  }

  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tokens = await this.stage1DiscoverTokens();
      const newTrades = await this.stage2IngestTrades(tokens);
      this.stage3and4ScoreWallets();
      await this.stage5TrackAndAlert(tokens);
      this.store.lastCycle = new Date().toISOString();
      this.store.lastError = null;
      this.logger.log(
        `Smart-money cycle: ${tokens.length} tokens, +${newTrades} trades, ${this.store.wallets.size} wallets`,
      );
    } catch (err) {
      this.store.lastError = err instanceof Error ? err.message : 'cycle failed';
      this.logger.warn(`Smart-money cycle failed: ${this.store.lastError}`);
    } finally {
      this.running = false;
    }
  }

  private async stage1DiscoverTokens(): Promise<TokenMarketSnapshot[]> {
    const cap = Number(process.env.SMART_MONEY_MAX_TOKENS_PER_CYCLE) || DISCOVERY_DEFAULTS.maxTokensPerCycle;
    const byMint = new Map<string, TokenMarketSnapshot>();
    const gecko = await discoverSolanaTokensFromGecko(40);
    if (gecko.ok && gecko.data) {
      for (const t of gecko.data) byMint.set(t.address, t);
    }
    const dex = await discoverNewSolanaMarkets(40);
    if (dex.ok && dex.data) {
      for (const t of dex.data) {
        const existing = byMint.get(t.address);
        if (!existing || (t.volume24h ?? 0) > (existing.volume24h ?? 0)) {
          byMint.set(t.address, t);
        }
      }
    }
    return [...byMint.values()]
      .filter((t) => {
        const mcap = t.marketCap ?? 0;
        const liq = t.liquidityUsd ?? 0;
        const vol = t.volume24h ?? 0;
        if (liq < 8_000 || vol < 5_000) return false;
        if (mcap > 15_000_000) return false;
        return looksLikeSolanaAddress(t.address);
      })
      .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
      .slice(0, cap);
  }

  private async stage2IngestTrades(tokens: TokenMarketSnapshot[]): Promise<number> {
    let added = 0;
    for (const token of tokens) {
      const res = await this.feed.fetchTokenTrades({
        mint: token.address,
        poolAddress: token.pairAddress,
        symbol: token.symbol,
        marketCap: token.marketCap,
        liquidity: token.liquidityUsd,
        limit: DISCOVERY_DEFAULTS.maxCandidatesPerToken,
      });
      if (!res.ok || !res.data?.length) continue;
      const trades: DexTrade[] = res.data
        .filter((t) => looksLikeSolanaAddress(t.wallet) && !isKnownInfrastructure(t.wallet))
        .map((t) => ({
          ...t,
          symbol: token.symbol,
        }));
      added += this.store.upsertTrades(trades);
      await this.persistTrades(trades, token);
    }
    return added;
  }

  private stage3and4ScoreWallets() {
    const counts = new Map<string, number>();
    for (const t of this.store.trades) {
      counts.set(t.wallet, (counts.get(t.wallet) ?? 0) + 1);
    }
    const now = Date.now();
    for (const [address, n] of counts) {
      if (n < 3) continue;
      const trades = this.store.trades;
      const stats = computeWalletStats(address, trades, now);
      if (stats.tokensTraded < 2 && stats.totalTrades < DISCOVERY_DEFAULTS.minTrades) continue;
      const bt = backtestWallet(address, trades);
      const decayed = decayedSmartScore(address, trades, now);
      const scoredBase = scoreWallet(stats);
      const smartScore = decayed.score * 0.7 + scoredBase.score * 0.3;
      const ex = evaluateExclusions({
        address,
        stats,
        trades: trades.filter((t) => t.wallet === address),
        clustered: bt.likelyLuck && stats.concentration > 0.8,
        extraInfra: extraInfrastructureAddresses(process.env.SMART_MONEY_INFRA_WALLETS),
      });
      const tier = classifyWallet({
        score: smartScore,
        stats,
        excluded: ex.excluded,
      });
      const scored: ScoredWallet = {
        address,
        smartScore,
        tier,
        stats,
        components: scoredBase.components,
        excluded: ex.excluded,
        excludeReasons: ex.reasons,
        influence: ex.excluded ? 0 : tierInfluence(tier),
      };
      this.store.scored.set(address, scored);
      const dash: DashboardWallet = {
        address,
        label: shortLabel(address),
        smartScore: Math.round(smartScore * 10) / 10,
        tier,
        status: tierLabel(tier),
        winRate: stats.winRate,
        roi: stats.roi,
        averageHoldMin: stats.averageHoldMs / 60000,
        earlyEntryScore: stats.earlyEntryScore,
        totalTrades: stats.totalTrades,
        profitableCalls: stats.profitableCalls,
        realizedPnl: stats.realizedPnl,
        lastActive: stats.lastActive ? new Date(stats.lastActive).toISOString() : null,
        confidenceScore: stats.confidence,
        excluded: ex.excluded,
        excludeReasons: ex.reasons,
        influence: scored.influence,
        windows: decayed.windows,
      };
      this.store.wallets.set(address, dash);
      void this.persistWallet(dash, scored);
    }
  }

  private async stage5TrackAndAlert(tokens: TokenMarketSnapshot[]) {
    const tracked = this.trackedWallets();
    if (!tracked.length) return;
    for (const token of tokens.slice(0, 6)) {
      try {
        await this.evaluateTokenAndMaybeAlert(token);
      } catch (err) {
        this.logger.warn(
          `Track ${token.symbol}: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
  }

  async evaluateTokenAndMaybeAlert(token: TokenMarketSnapshot) {
    const consensus = this.getConsensus(token.address);
    const safety = await this.safety.analyzeAddress(token.address, token);
    const ohlcv5 = await fetchTokenOhlcv(token.address, '5m', token.pairAddress, 80);
    const ohlcv15 = await fetchTokenOhlcv(token.address, '15m', token.pairAddress, 80);
    const snap5 = ohlcv5.ok && ohlcv5.data ? buildIndicatorSnapshot(ohlcv5.data.candles, '5m') : null;
    const snap15 =
      ohlcv15.ok && ohlcv15.data ? buildIndicatorSnapshot(ohlcv15.data.candles, '15m') : null;
    const technical5m = snap5 ? scoreTechnicalFromSnapshot(snap5) : 45;
    const meme = computeMemeCoinScore({
      consensus,
      token: {
        liquidityUsd: token.liquidityUsd,
        liquidityGrowthPct: null,
        top10Pct: safety.top10Pct,
        volume1m: null,
        volume5m: token.volumeM5 ?? null,
        volume15m: null,
        volume24h: token.volume24h,
        buys1m: null,
        sells1m: null,
        buys5m: token.buysM5 ?? null,
        sells5m: token.sellsM5 ?? null,
        holderCount: safety.holderSampleCount,
        holderGrowthPct: null,
        newWalletGrowthPct: null,
        marketCap: token.marketCap,
        marketCapGrowthPct: token.priceChangeH1 ?? null,
        technical5m,
        trend15mBullish: snap15?.trend === 'BULLISH',
        higherHighs: Boolean(snap5?.higherHighs),
        higherLows: Boolean(snap5?.higherLows),
        breakout: Boolean(snap5?.breakout),
        volumeExpansion: Boolean(snap5?.volumeExpansion),
        hugeSingleCandle: (token.priceChangeM5 ?? 0) >= 18,
      },
      risk: {
        top10Pct: safety.top10Pct,
        liquidityUsd: token.liquidityUsd,
        volume24h: token.volume24h,
        buys24h: token.buys24h,
        sells24h: token.sells24h,
        mintAuthorityActive: safety.mintAuthorityRevoked === false,
        freezeAuthorityActive: safety.freezeAuthorityRevoked === false,
        dangerRiskCount: safety.risks.filter((r) => r.level === 'danger' || r.level === 'critical')
          .length,
        honeypot: safety.risks.some((r) => /honeypot|can't sell|cant sell/i.test(r.name)),
        smartMoneyNetSelling: this.smartMoneyNetSelling(token.address),
      },
    });
    this.store.pushSignal(meme, token.address, token.symbol);
    await this.persistSignal(meme, token);
    if (consensus && meme.overall >= 80 && meme.risk.severity !== 'HIGH') {
      await this.maybeAlert(token, meme, consensus, snap5, snap15);
    }
  }

  private smartMoneyNetSelling(token: string): boolean {
    const from = Date.now() - 20 * 60_000;
    const tracked = new Set(this.trackedWallets().map((w) => w.address));
    let buy = 0;
    let sell = 0;
    for (const t of this.store.trades) {
      if (t.token !== token || t.timestamp < from || !tracked.has(t.wallet)) continue;
      if (t.type === 'buy') buy += 1;
      else sell += 1;
    }
    return sell > buy && sell >= 3;
  }

  private async maybeAlert(
    token: TokenMarketSnapshot,
    meme: ReturnType<typeof computeMemeCoinScore>,
    consensus: NonNullable<ReturnType<SmartMoneyService['getConsensus']>>,
    snap5: ReturnType<typeof buildIndicatorSnapshot> | null,
    snap15: ReturnType<typeof buildIndicatorSnapshot> | null,
  ) {
    const key = token.address.toLowerCase();
    const now = Date.now();
    const last = this.alerted.get(key) ?? 0;
    if (now - last < 20 * 60_000) return;
    const msg = formatSmartMoneyAlert({
      symbol: token.symbol,
      mint: token.address,
      overall: meme.overall,
      level: meme.level,
      consensus,
      liquidityUsd: token.liquidityUsd,
      trend5m: snap5?.trend === 'BULLISH' ? 'Bullish' : snap5?.trend === 'BEARISH' ? 'Bearish' : 'Range',
      trend15m:
        snap15?.trend === 'BULLISH' ? 'Bullish' : snap15?.trend === 'BEARISH' ? 'Bearish' : 'Range',
      volumeChangePct: token.priceChangeM5 ?? null,
      holderGrowthPct: null,
      buySellRatio:
        token.buysM5 != null && token.sellsM5
          ? token.buysM5 / Math.max(token.sellsM5, 1)
          : token.buys24h != null && token.sells24h
            ? token.buys24h / Math.max(token.sells24h, 1)
            : null,
      risk: meme.risk,
    });
    await this.notifications.notify(msg.title, msg.body);
    this.alerted.set(key, now);
  }

  async hydrateMarket(address: string): Promise<TokenMarketSnapshot | null> {
    const dex = await fetchDexScreenerToken(address);
    if (dex.ok && dex.data) return dex.data;
    const gecko = await fetchGeckoToken(address);
    if (gecko.ok && gecko.data) return gecko.data;
    return null;
  }

  private async persistTrades(trades: DexTrade[], token: TokenMarketSnapshot) {
    if (!isDbConnected()) return;
    try {
      await TrackedToken.findOneAndUpdate(
        { tokenAddress: token.address },
        {
          $set: {
            symbol: token.symbol,
            name: token.name,
            marketCap: token.marketCap,
            liquidity: token.liquidityUsd,
            volume: token.volume24h,
            buyCount: token.buys24h,
            sellCount: token.sells24h,
            pairAddress: token.pairAddress,
            lastTradesAt: new Date(),
          },
        },
        { upsert: true },
      );
      for (const t of trades) {
        await WalletTransaction.updateOne(
          {
            transactionHash: t.txHash,
            wallet: t.wallet,
            transactionType: t.type,
            token: t.token,
          },
          {
            $setOnInsert: {
              symbol: token.symbol,
              amount: t.amount,
              usdValue: t.usdValue,
              price: t.price,
              marketCap: t.marketCap,
              liquidity: t.liquidity,
              timestamp: new Date(t.timestamp),
              provider: t.provider ?? 'geckoterminal',
            },
          },
          { upsert: true },
        );
      }
    } catch (err) {
      this.logger.warn(`persist trades: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  private async persistWallet(dash: DashboardWallet, scored: ScoredWallet) {
    if (!isDbConnected()) return;
    try {
      await DiscoveredWallet.findOneAndUpdate(
        { address: dash.address },
        {
          $set: {
            label: dash.label,
            smartScore: dash.smartScore,
            tier: dash.tier,
            totalTrades: dash.totalTrades,
            winningTrades: scored.stats.winningTrades,
            losingTrades: scored.stats.losingTrades,
            winRate: dash.winRate,
            realizedPnl: dash.realizedPnl,
            unrealizedPnl: scored.stats.unrealizedPnl,
            roi: dash.roi,
            averageHoldTimeMs: scored.stats.averageHoldMs,
            earlyEntryScore: dash.earlyEntryScore,
            riskScore: scored.stats.riskScore,
            firstSeen: scored.stats.firstSeen ? new Date(scored.stats.firstSeen) : null,
            lastActive: dash.lastActive ? new Date(dash.lastActive) : null,
            confidenceScore: dash.confidenceScore,
            tokensTraded: scored.stats.tokensTraded,
            profitableCalls: dash.profitableCalls,
            failedCalls: scored.stats.failedCalls,
            consistency: scored.stats.consistency,
            luckScore: scored.stats.luckScore,
            excluded: dash.excluded,
            excludeReasons: dash.excludeReasons,
            influence: scored.influence,
            windows: dash.windows,
            origin: 'DISCOVERED',
          },
        },
        { upsert: true },
      );
    } catch (err) {
      this.logger.warn(`persist wallet: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  private async persistSignal(
    meme: ReturnType<typeof computeMemeCoinScore>,
    token: TokenMarketSnapshot,
  ) {
    if (!isDbConnected()) return;
    try {
      await MemeSignal.create({
        token: token.address,
        symbol: token.symbol,
        smartMoneyScore: meme.breakdown.smartMoney,
        overallScore: meme.overall,
        numberOfSmartWallets: meme.consensus?.independentWallets ?? 0,
        tierAWallets: meme.consensus?.tierA ?? 0,
        tierBWallets: meme.consensus?.tierB ?? 0,
        liquidityScore: meme.breakdown.liquidity,
        volumeScore: meme.breakdown.volume,
        holderScore: meme.breakdown.holders,
        technicalScore: meme.breakdown.technical5m,
        riskScore: meme.breakdown.risk,
        signal: meme.level,
        reason: meme.reason,
        timestamp: new Date(),
      });
    } catch (err) {
      this.logger.warn(`persist signal: ${err instanceof Error ? err.message : 'error'}`);
    }
  }
}
