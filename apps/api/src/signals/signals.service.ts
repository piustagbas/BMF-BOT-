import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import {
  discoverSolanaTokensFromGecko,
  fetchDexScreenerToken,
  fetchGeckoToken,
  fetchTokenOhlcv,
  inspectSmartMoneyWallets,
  pingGeckoTerminal,
  type TokenMarketSnapshot,
} from '@memecoinbot/data-providers';
import {
  analyzeCandlestickStructure,
  buildChartGuide,
  buildIndicatorSnapshot,
  pickChartTimeframes,
  type ChartGuide,
  type Timeframe,
} from '@memecoinbot/indicators';
import {
  analyzeMomentum,
  evaluateStrategies,
  type StrategyResult,
} from '@memecoinbot/strategies';
import {
  buildBeginnerSignalExplain,
  calculateTradeLevels,
  evaluateMasterStrategy,
  scoreSmartMoneyFromHoldings,
  scoreSmartMoneyFromConsensus,
  scoreSocialSentiment,
  scoreFomoPump,
  scoreTechnicalFromSnapshot,
  scoreVolumeFromSnapshot,
  unavailableMasterResult,
  validateEntryPrice,
  type WhyNotBuyPanel,
} from '@memecoinbot/scoring';
import {
  DISCLAIMER,
  SignalType,
  getVerifiedSmartWallets,
  isNewCoinAge,
  mergeAllSmartWallets,
} from '@memecoinbot/shared';
import {
  trackSignalOutcome,
  type SignalOutcome,
} from '@memecoinbot/backtest';
import { WatchlistItem, isDbConnected } from '@memecoinbot/db';
import { SafetyService } from '../safety/safety.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmartMoneyService } from '../smart-money/smart-money.service';
import { computeMemeCoinScore } from '@memecoinbot/smart-money';

export type GeneratedSignal = {
  token: {
    address: string;
    name: string;
    symbol: string;
      imageUrl: string | null;
      priceUsd: number | null;
      liquidityUsd: number | null;
      volume24h: number | null;
      pairAddress: string | null;
      pairAgeHours: number | null;
      source: string;
      jupiterPriceUsd: number | null;
  };
  signalType: SignalType;
  safetyScore: number;
  signalScore: number;
  buyScore: number;
  axiomScore: null;
  axiomUnavailable: true;
  criticalWarning: boolean;
  strategy: StrategyResult | null;
  strategies: StrategyResult[];
  momentum: { score: number; notes: string[]; exhaustion: boolean };
  indicators: {
    primary: ReturnType<typeof buildIndicatorSnapshot>;
    confirmation: ReturnType<typeof buildIndicatorSnapshot> | null;
  };
  levels: ReturnType<typeof calculateTradeLevels>;
  failedChecks: string[];
  whyNotBuy: WhyNotBuyPanel;
  buyBreakdown: {
    safety: number;
    technical: number;
    momentum: number;
    candlestick: number;
    smartMoney: number | null;
    social: number;
    fomoQuality: number;
  };
  independent: {
    agreeing: number;
    required: number;
    signals: Array<{ key: string; label: string; agrees: boolean; detail: string }>;
  };
  beginner: ReturnType<typeof buildBeginnerSignalExplain>;
  disclaimer: string;
  generatedAt: string;
  ohlcvUnavailable: boolean;
  /** Live chart clock for this signal — not a static 5m/15m label */
  chart: ChartGuide;
  memeScore?: {
    overall: number;
    level: string;
    smartMoney: number;
    liquidity: number;
    volume: number;
    holders: number;
    pressure: number;
    technical5m: number;
    trend15m: number;
    risk: number;
    independentWallets: number;
    tierA: number;
    tierB: number;
    reason: string;
    canEmitBuy: boolean;
  };
};

export type BuyResultStatus = 'SUCCESS' | 'FAIL' | 'OPEN';

export type TrackedBuySetup = {
  id: string;
  address: string;
  symbol: string;
  name: string;
  pairAddress: string | null;
  generatedAt: string;
  signalTime: number;
  timeframe: Timeframe;
  safetyScore: number;
  buyScore: number;
  entry: number;
  stopLoss: number;
  tp1Price: number;
  tp2Price: number;
  result: BuyResultStatus;
  outcome: SignalOutcome | null;
  error?: string;
  resolvedAt: string | null;
};

@Injectable()
export class SignalsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalsService.name);
  private readonly recent: GeneratedSignal[] = [];
  private readonly buyLog: TrackedBuySetup[] = [];
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private firstScanTimer: ReturnType<typeof setTimeout> | null = null;
  private scanRunning = false;

  constructor(
    private readonly safetyService: SafetyService,
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly smartMoney: SmartMoneyService,
  ) {}

  onModuleInit() {
    this.firstScanTimer = setTimeout(() => void this.scanForBuyAlerts(), 25_000);
    this.scanTimer = setInterval(() => void this.scanForBuyAlerts(), 4 * 60 * 1000);
    this.logger.log('BUY alert scanner armed (first run in 25s, then every 4m)');
  }

  onModuleDestroy() {
    if (this.firstScanTimer) clearTimeout(this.firstScanTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
  }

  listRecent(limit = 20): GeneratedSignal[] {
    return this.recent.slice(0, Math.min(Math.max(limit, 1), 50));
  }

  private async fetchMarket(
    address: string,
  ): Promise<{ ok: true; data: TokenMarketSnapshot } | { ok: false; error?: string }> {
    const dex = await fetchDexScreenerToken(address);
    if (dex.ok && dex.data) return { ok: true, data: dex.data };
    this.logger.warn(
      `Signal market DEX miss ${address.slice(0, 8)}… — Gecko (${dex.error ?? 'n/a'})`,
    );
    const gecko = await fetchGeckoToken(address);
    if (gecko.ok && gecko.data) return { ok: true, data: gecko.data };
    return { ok: false, error: gecko.error ?? dex.error };
  }

  private tokenPayload(market: TokenMarketSnapshot) {
    return {
      address: market.address,
      name: market.name,
      symbol: market.symbol,
      imageUrl: market.imageUrl ?? null,
      priceUsd: market.priceUsd,
      liquidityUsd: market.liquidityUsd,
      volume24h: market.volume24h,
      pairAddress: market.pairAddress,
      pairAgeHours: market.pairAgeHours,
      source: market.source,
      jupiterPriceUsd: null as number | null,
    };
  }

  private chartGuide(
    market: TokenMarketSnapshot,
    opts?: { primaryTf?: Timeframe; confirmTf?: Timeframe },
  ): ChartGuide {
    const picked = pickChartTimeframes({
      pairAgeHours: market.pairAgeHours,
      priceChangeM5: market.priceChangeM5,
      priceChangeH1: market.priceChangeH1,
      priceChange24h: market.priceChange24h,
      requestedPrimary: opts?.primaryTf,
      requestedConfirm: opts?.confirmTf,
    });
    return buildChartGuide(picked);
  }

  async generateForAddress(
    address: string,
    opts?: { primaryTf?: Timeframe; confirmTf?: Timeframe },
  ): Promise<GeneratedSignal> {
    const market = await this.fetchMarket(address);
    if (!market.ok) {
      throw new ServiceUnavailableException(
        market.error ?? 'Market data unavailable',
      );
    }

    const safety = await this.safetyService.analyzeAddress(address, market.data);
    const price = market.data.priceUsd;
    if (price == null || price <= 0) {
      throw new ServiceUnavailableException('No usable price for signal');
    }

    const chart = this.chartGuide(market.data, opts);
    const primaryTf = chart.primary;
    const confirmTf = chart.confirm;

    // Sequential OHLCV to avoid GeckoTerminal 429 (parallel doubles the hit rate)
    const primaryOhlcv = await fetchTokenOhlcv(
      address,
      primaryTf,
      market.data.pairAddress,
    );
    await new Promise((r) => setTimeout(r, 400));
    const confirmOhlcv = await fetchTokenOhlcv(
      address,
      confirmTf,
      market.data.pairAddress,
    );

    const ohlcvUnavailable = !primaryOhlcv.ok;
    if (ohlcvUnavailable) {
      // Fail safe: without candles we cannot confirm technicals → NO TRADE
      const levels = calculateTradeLevels({
        currentPrice: price,
        atr: price * 0.04,
        support: price * 0.92,
      });
      const master = unavailableMasterResult({
        safetyScore: safety.safetyScore,
        levels,
        reason: primaryOhlcv.error ?? 'OHLCV unavailable — technical confirmation blocked',
        criticalWarning: safety.criticalWarning,
      });
      const signal: GeneratedSignal = {
        token: this.tokenPayload(market.data),
        signalType: SignalType.NO_TRADE,
        safetyScore: safety.safetyScore,
        signalScore: 0,
        buyScore: 0,
        axiomScore: null,
        axiomUnavailable: true,
        criticalWarning: safety.criticalWarning,
        strategy: null,
        strategies: [],
        momentum: { score: 0, notes: ['OHLCV unavailable'], exhaustion: false },
        indicators: {
          primary: buildIndicatorSnapshot(
            [
              {
                time: Date.now() / 1000,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: 0,
              },
            ],
            primaryTf,
          ),
          confirmation: null,
        },
        levels,
        failedChecks: master.failedChecks,
        whyNotBuy: master.whyNotBuy,
        buyBreakdown: master.components,
        independent: {
          agreeing: master.agreeing,
          required: master.required,
          signals: master.independent.map((s) => ({
            key: s.key,
            label: s.label,
            agrees: s.agrees,
            detail: s.detail,
          })),
        },
        beginner: {
          whatBotSees: ['Candle data unavailable'],
          whyItLikes: ['NO TRADE — cannot confirm technical setup'],
          whatCouldGoWrong: [
            'Trading without candles is unsafe for this engine.',
            'This is not a guarantee.',
          ],
          decision: 'NO TRADE',
        },
        disclaimer: DISCLAIMER,
        generatedAt: new Date().toISOString(),
        ohlcvUnavailable: true,
        chart,
      };
      this.pushRecent(signal);
      return signal;
    }

    const primary = buildIndicatorSnapshot(primaryOhlcv.data!.candles, primaryTf);
    const confirmation = confirmOhlcv.ok
      ? buildIndicatorSnapshot(confirmOhlcv.data!.candles, confirmTf)
      : null;

    const momentum = analyzeMomentum(primary);
    const volumeScore = scoreVolumeFromSnapshot(primary);
    const technicalScore = scoreTechnicalFromSnapshot(primary);
    const candlestick = analyzeCandlestickStructure(primaryOhlcv.data!.candles);

    const strategies = evaluateStrategies({
      primary,
      confirmation,
      momentumScore: momentum.score,
      volumeScore,
    });
    const triggered = strategies.filter((s) => s.triggered);
    const best = [...triggered].sort((a, b) => b.confidence - a.confidence)[0] ?? null;

    const risk = this.settingsService.getRisk();

    let levels = calculateTradeLevels({
      currentPrice: price,
      atr: primary.atr,
      support: primary.support,
      swingLow: primary.support,
      tp1Pct: risk.tp1Pct,
      tp2Pct: risk.tp2Pct,
      tp1SellPct: risk.tp1SellPct,
      tp2SellPct: risk.tp2SellPct,
      remainingPct: risk.remainingPct,
    });
    levels = validateEntryPrice(levels, price);

    const wallets = mergeAllSmartWallets(
      getVerifiedSmartWallets(process.env.VERIFIED_SMART_WALLETS),
      this.settingsService.getTrackedWallets(),
      this.smartMoney.trackedWallets(),
    );
    const consensus = this.smartMoney.getConsensus(address);
    const smInspect = await inspectSmartMoneyWallets(address, wallets);
    const holderLabels =
      smInspect.data?.holdings.filter((h) => h.holds).map((h) => h.wallet.label) ?? [];
    const smartMoney = consensus
      ? scoreSmartMoneyFromConsensus({
          available: true,
          independent: consensus.independentWallets,
          tierA: consensus.tierA,
          tierB: consensus.tierB,
          strength: consensus.strength,
          reason: consensus.reason,
        })
      : scoreSmartMoneyFromHoldings({
          walletsChecked: smInspect.data?.walletsChecked ?? 0,
          holders: smInspect.data?.holders ?? 0,
          unavailable: !smInspect.ok || Boolean(smInspect.data?.unavailable),
          labels: holderLabels,
        });

    const social = scoreSocialSentiment({
      buys24h: market.data.buys24h,
      sells24h: market.data.sells24h,
      volume24h: market.data.volume24h,
      liquidityUsd: market.data.liquidityUsd,
      marketCap: market.data.marketCap,
      priceChangeH1: market.data.priceChangeH1 ?? null,
      priceChange24h: market.data.priceChange24h,
    });
    const fomo = scoreFomoPump({
      priceChangeM5: market.data.priceChangeM5 ?? null,
      priceChangeH1: market.data.priceChangeH1 ?? null,
      priceChange24h: market.data.priceChange24h,
      pairAgeHours: market.data.pairAgeHours,
      rsi: primary.rsi,
      volumeExpansion: primary.volumeExpansion,
      volume24h: market.data.volume24h,
      liquidityUsd: market.data.liquidityUsd,
    });

    const meme = computeMemeCoinScore({
      consensus,
      token: {
        liquidityUsd: market.data.liquidityUsd,
        liquidityGrowthPct: null,
        top10Pct: safety.top10Pct,
        volume1m: null,
        volume5m: market.data.volumeM5 ?? null,
        volume15m: null,
        volume24h: market.data.volume24h,
        buys1m: null,
        sells1m: null,
        buys5m: market.data.buysM5 ?? null,
        sells5m: market.data.sellsM5 ?? null,
        holderCount: safety.holderSampleCount,
        holderGrowthPct: null,
        newWalletGrowthPct: null,
        marketCap: market.data.marketCap ?? null,
        marketCapGrowthPct: market.data.priceChangeH1 ?? null,
        technical5m: technicalScore,
        trend15mBullish: confirmation?.trend === 'BULLISH',
        higherHighs: primary.higherHighs,
        higherLows: primary.higherLows,
        breakout: primary.breakout,
        volumeExpansion: primary.volumeExpansion,
        hugeSingleCandle: (market.data.priceChangeM5 ?? 0) >= 18,
      },
      risk: {
        top10Pct: safety.top10Pct,
        liquidityUsd: market.data.liquidityUsd,
        volume24h: market.data.volume24h,
        buys24h: market.data.buys24h,
        sells24h: market.data.sells24h,
        mintAuthorityActive: safety.mintAuthorityRevoked === false,
        freezeAuthorityActive: safety.freezeAuthorityRevoked === false,
        dangerRiskCount: safety.risks.filter(
          (r) => r.level === 'danger' || r.level === 'critical',
        ).length,
        honeypot: safety.risks.some((r) => /honeypot|can't sell|cant sell/i.test(r.name)),
      },
    });
    const extraFailed: string[] = [];
    if (meme.overall < 60) {
      extraFailed.push('Meme-coin score below 60 — AVOID (not a BUY)');
    }
    if (meme.downgraded) {
      extraFailed.push('Smart-money flow is not confirmed by liquidity or 5m structure');
    }

    const master = evaluateMasterStrategy({
      safetyScore: safety.safetyScore,
      technicalScore,
      momentumScore: momentum.score,
      candlestick,
      smartMoney,
      social,
      fomo,
      levels,
      liquidityUsd: market.data.liquidityUsd,
      safetyMin: risk.safetyMin,
      signalMin: risk.signalMin,
      minLiquidityUsd: risk.minLiquidityUsd,
      minRiskReward: risk.minRiskReward,
      criticalWarning: safety.criticalWarning,
      dataConflict: false,
      marketDataCurrent: true,
      strategiesTriggered: triggered.length,
      exhaustion: momentum.exhaustion,
      extraFailed,
    });

    const signalType = master.signalType;

    const checks = [
      `Safety ${safety.safetyScore}/100`,
      `Buy score ${master.buyScore}/100`,
      `Independent ${master.agreeing}/${master.required}`,
      `Market ${market.data.source}`,
      `Trend ${primary.trend}`,
      `RSI ${primary.rsi?.toFixed(1) ?? 'n/a'}`,
      `Candles ${candlestick.pattern}`,
      `FOMO ${fomo.extremeFomo ? 'EXTREME' : fomo.fomoScore}`,
      `Smart money ${smartMoney.holders}/${smartMoney.walletsChecked}`,
      `Meme score ${meme.overall}/100 (${meme.level})`,
      `Follow ${primaryTf} · confirm ${confirmTf}`,
    ];

    const signal: GeneratedSignal = {
      token: this.tokenPayload(market.data),
      signalType,
      safetyScore: safety.safetyScore,
      signalScore: master.signalScore,
      buyScore: master.buyScore,
      axiomScore: null,
      axiomUnavailable: true,
      criticalWarning: safety.criticalWarning,
      strategy: best,
      strategies,
      momentum,
      indicators: { primary, confirmation },
      levels,
      failedChecks: master.failedChecks,
      whyNotBuy: master.whyNotBuy,
      buyBreakdown: master.components,
      independent: {
        agreeing: master.agreeing,
        required: master.required,
        signals: master.independent.map((s) => ({
          key: s.key,
          label: s.label,
          agrees: s.agrees,
          detail: s.detail,
        })),
      },
      beginner: buildBeginnerSignalExplain({
        signalType,
        checks,
        failedChecks: master.failedChecks,
        strategy: best,
        levels,
      }),
      disclaimer: DISCLAIMER,
      generatedAt: new Date().toISOString(),
      ohlcvUnavailable: false,
      chart,
      memeScore: {
        overall: meme.overall,
        level: meme.level,
        smartMoney: meme.breakdown.smartMoney,
        liquidity: meme.breakdown.liquidity,
        volume: meme.breakdown.volume,
        holders: meme.breakdown.holders,
        pressure: meme.breakdown.pressure,
        technical5m: meme.breakdown.technical5m,
        trend15m: meme.breakdown.trend15m,
        risk: meme.breakdown.risk,
        independentWallets: meme.consensus?.independentWallets ?? 0,
        tierA: meme.consensus?.tierA ?? 0,
        tierB: meme.consensus?.tierB ?? 0,
        reason: meme.reason,
        canEmitBuy: meme.canEmitBuy,
      },
    };

    this.pushRecent(signal);
    this.recordBuySetup(signal);
    await this.persistBestEffort(signal);

    if (signal.signalType === SignalType.BUY) {
      try {
        await this.notifications.notifyBuySetup({
          symbol: signal.token.symbol,
          mint: signal.token.address,
          pairAddress: signal.token.pairAddress,
          safety: signal.safetyScore,
          signal: signal.signalScore,
          axiom: null,
          entryMin: signal.levels.entryMin,
          entryMax: signal.levels.entryMax,
          stopLoss: signal.levels.stopLoss,
          tp1Pct: signal.levels.tp1Pct,
          tp2Pct: signal.levels.tp2Pct,
          remainingPct: signal.levels.remainingPct,
          riskReward: signal.levels.riskReward,
          reason: signal.strategy?.reason ?? 'Configured filters passed',
        });
      } catch (err) {
        this.logger.warn(
          `BUY alert failed for $${signal.token.symbol}: ${
            err instanceof Error ? err.message : 'error'
          }`,
        );
      }
    }

    return signal;
  }

  async scanTop(limit = 5): Promise<GeneratedSignal[]> {
    const {
      discoverNewSolanaMarkets,
      discoverSolanaTokenAddresses,
    } = await import('@memecoinbot/data-providers');
    const poolSize = Math.min(Math.max(limit * 8, 50), 120);
    let candidates: Array<{ address: string; pairAgeHours: number | null }> = [];

    const markets = await discoverNewSolanaMarkets(poolSize);
    if (markets.ok && markets.data?.length) {
      candidates = markets.data
        .filter((t) => isNewCoinAge(t.pairAgeHours))
        .slice(0, limit)
        .map((t) => ({ address: t.address, pairAgeHours: t.pairAgeHours }));
    }

    if (candidates.length < limit) {
      const discovered = await discoverSolanaTokenAddresses(poolSize);
      if (discovered.ok && discovered.data?.length) {
        const seen = new Set(candidates.map((c) => c.address));
        for (const address of discovered.data) {
          if (seen.has(address)) continue;
          try {
            const m = await this.fetchMarket(address);
            if (!m.ok) continue;
            if (!isNewCoinAge(m.data.pairAgeHours)) continue;
            candidates.push({ address, pairAgeHours: m.data.pairAgeHours });
            seen.add(address);
          } catch {
            /* skip */
          }
          if (candidates.length >= limit) break;
        }
      }
    }

    if (candidates.length < limit) {
      const gecko = await discoverSolanaTokensFromGecko(poolSize);
      if (gecko.ok && gecko.data?.length) {
        const seen = new Set(candidates.map((c) => c.address));
        for (const t of gecko.data.filter((x) => isNewCoinAge(x.pairAgeHours))) {
          if (seen.has(t.address)) continue;
          candidates.push({ address: t.address, pairAgeHours: t.pairAgeHours });
          seen.add(t.address);
          if (candidates.length >= limit) break;
        }
      }
    }

    if (!candidates.length) {
      return this.listRecent(limit);
    }

    const out: GeneratedSignal[] = [];
    for (const { address } of candidates.slice(0, limit)) {
      try {
        out.push(await this.generateForAddress(address));
      } catch (err) {
        this.logger.warn(
          `Signal scan skipped ${address}: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
    return out;
  }

  /** Periodic scan so BUY setups alert Gmail/Telegram without opening the token. */
  async scanForBuyAlerts(): Promise<void> {
    if (this.scanRunning) return;
    this.scanRunning = true;
    try {
      const seen = new Set<string>();
      const fromScan = await this.scanTop(4);
      for (const s of fromScan) seen.add(s.token.address);

      if (isDbConnected()) {
        const watched = await WatchlistItem.find({})
          .select('address')
          .sort({ updatedAt: -1 })
          .limit(8)
          .lean();
        for (const item of watched) {
          if (seen.has(item.address)) continue;
          seen.add(item.address);
          try {
            await this.generateForAddress(item.address);
          } catch (err) {
            this.logger.warn(
              `Watchlist BUY scan skipped ${item.address.slice(0, 8)}…: ${
                err instanceof Error ? err.message : 'error'
              }`,
            );
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const buys = fromScan.filter((s) => s.signalType === SignalType.BUY);
      this.logger.log(
        `BUY alert scan finished: ${seen.size} tokens, ${buys.length} BUY from live scan`,
      );
    } catch (err) {
      this.logger.warn(
        `BUY alert scan failed: ${err instanceof Error ? err.message : 'error'}`,
      );
    } finally {
      this.scanRunning = false;
    }
  }

  async healthOhlcv() {
    return pingGeckoTerminal();
  }

  listBuyResults() {
    const items = this.buyLog;
    const success = items.filter((i) => i.result === 'SUCCESS').length;
    const fail = items.filter((i) => i.result === 'FAIL').length;
    const open = items.filter((i) => i.result === 'OPEN').length;
    const decided = success + fail;
    return {
      items,
      count: items.length,
      success,
      fail,
      open,
      successRatePct: decided > 0 ? Math.round((success / decided) * 1000) / 10 : null,
      note:
        'SUCCESS/FAIL is “if you had entered at the bot entry with this SL/TP”. DexScreener buys do not auto-attach those levels. Log is in-memory (clears on API restart).',
    };
  }

  async refreshBuyResults(limit = 8) {
    const pending = this.buyLog.filter((i) => i.result === 'OPEN').slice(0, limit);
    for (const item of pending) {
      try {
        const ohlcv = await fetchTokenOhlcv(
          item.address,
          item.timeframe,
          item.pairAddress,
        );
        if (!ohlcv.ok || !ohlcv.data) {
          item.error = ohlcv.error ?? 'OHLCV unavailable';
          continue;
        }
        const outcome = trackSignalOutcome({
          entryPrice: item.entry,
          stopLoss: item.stopLoss,
          tp1Price: item.tp1Price,
          tp2Price: item.tp2Price,
          signalTime: item.signalTime,
          candles: ohlcv.data.candles,
        });
        item.outcome = outcome;
        item.error = undefined;
        if (outcome.firstExit === 'SL') item.result = 'FAIL';
        else if (outcome.firstExit === 'TP1' || outcome.firstExit === 'TP2') {
          item.result = 'SUCCESS';
        } else {
          item.result = 'OPEN';
        }
        if (item.result !== 'OPEN') {
          item.resolvedAt = new Date().toISOString();
        }
      } catch (err) {
        item.error = err instanceof Error ? err.message : 'Resolve failed';
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return this.listBuyResults();
  }

  private recordBuySetup(signal: GeneratedSignal) {
    if (signal.signalType !== SignalType.BUY) return;
    const dup = this.buyLog.find(
      (i) =>
        i.address === signal.token.address &&
        Date.now() - new Date(i.generatedAt).getTime() < 45 * 60 * 1000,
    );
    if (dup) return;
    this.buyLog.unshift({
      id: `buy_${Date.now()}_${signal.token.address.slice(0, 6)}`,
      address: signal.token.address,
      symbol: signal.token.symbol,
      name: signal.token.name,
      pairAddress: signal.token.pairAddress,
      generatedAt: signal.generatedAt,
      signalTime: Math.floor(new Date(signal.generatedAt).getTime() / 1000),
      timeframe: signal.chart.primary,
      safetyScore: signal.safetyScore,
      buyScore: signal.buyScore,
      entry: signal.levels.idealEntry,
      stopLoss: signal.levels.stopLoss,
      tp1Price: signal.levels.tp1Price,
      tp2Price: signal.levels.tp2Price,
      result: 'OPEN',
      outcome: null,
      resolvedAt: null,
    });
    if (this.buyLog.length > 100) this.buyLog.length = 100;
  }

  private pushRecent(signal: GeneratedSignal) {
    this.recent.unshift(signal);
    if (this.recent.length > 100) this.recent.length = 100;
  }

  private async persistBestEffort(signal: GeneratedSignal): Promise<void> {
    void signal;
    return;
  }
}
