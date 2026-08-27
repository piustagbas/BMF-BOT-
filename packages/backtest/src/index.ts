import type { Candle, Timeframe } from '@memecoinbot/indicators';
import { buildIndicatorSnapshot } from '@memecoinbot/indicators';
import {
  createPaperAccount,
  openPaperPosition,
  processPriceUpdate,
  forceCloseRemaining,
  computePaperPerformance,
  type PaperConfig,
  DEFAULT_PAPER_CONFIG,
} from '@memecoinbot/paper-engine';
import {
  calculateTradeLevels,
  scoreTechnicalFromSnapshot,
  scoreVolumeFromSnapshot,
} from '@memecoinbot/scoring';
import { analyzeMomentum, evaluateStrategies } from '@memecoinbot/strategies';
import { StrategyId } from '@memecoinbot/shared';

export type BacktestConfig = {
  startingBalance: number;
  timeframe: Timeframe;
  strategyId?: StrategyId | 'ALL';
  warmupBars: number;
  outOfSamplePct: number;
  minBarsBetweenEntries: number;
  paper?: Partial<PaperConfig>;
  tokenAddress?: string;
  symbol?: string;
};

export type BacktestTradeSummary = {
  entryTime: number;
  exitTime?: number;
  entryPrice: number;
  exitPrice?: number;
  pnlUsd: number;
  exitReason?: string;
  strategy?: string;
  tp1Hit: boolean;
  tp2Hit: boolean;
};

export type BacktestSegmentResult = {
  label: 'IN_SAMPLE' | 'OUT_OF_SAMPLE' | 'FULL';
  bars: number;
  performance: ReturnType<typeof computePaperPerformance>;
  trades: BacktestTradeSummary[];
  signalsGenerated: number;
  entriesTaken: number;
};

export type BacktestResult = {
  config: BacktestConfig;
  inSample: BacktestSegmentResult;
  outOfSample: BacktestSegmentResult;
  full: BacktestSegmentResult;
  warning: string;
  generatedAt: string;
};

function splitCandles(candles: Candle[], outOfSamplePct: number) {
  const pct = Math.min(Math.max(outOfSamplePct, 0.15), 0.5);
  const splitIndex = Math.max(
    Math.floor(candles.length * (1 - pct)),
    Math.floor(candles.length * 0.5),
  );
  return {
    inSample: candles.slice(0, splitIndex),
    outOfSample: candles.slice(splitIndex),
  };
}

function toTradeSummaries(
  account: ReturnType<typeof createPaperAccount>,
): BacktestTradeSummary[] {
  return account.closedTrades.map((t) => ({
    entryTime: Date.parse(t.openedAt) / 1000,
    exitTime: t.closedAt ? Date.parse(t.closedAt) / 1000 : undefined,
    entryPrice: t.entryPrice,
    exitPrice: t.fills[t.fills.length - 1]?.price,
    pnlUsd: t.realizedPnlUsd,
    exitReason: t.exitReason,
    strategy: t.strategy,
    tp1Hit: t.tp1Hit,
    tp2Hit: t.tp2Hit,
  }));
}

function runSegment(
  candles: Candle[],
  config: BacktestConfig,
  label: BacktestSegmentResult['label'],
): BacktestSegmentResult {
  let account = createPaperAccount(config.startingBalance);
  let signalsGenerated = 0;
  let entriesTaken = 0;
  let lastEntryBar = -Infinity;
  const paperCfg = { ...DEFAULT_PAPER_CONFIG, ...config.paper };
  const warmup = Math.max(config.warmupBars, 55);
  const tokenAddress = config.tokenAddress ?? 'BACKTEST_TOKEN';
  const symbol = config.symbol ?? 'BT';

  for (let i = warmup; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = candles[i]!;
    const primary = buildIndicatorSnapshot(window, config.timeframe);
    const momentum = analyzeMomentum(primary);
    const strategies = evaluateStrategies({
      primary,
      confirmation: null,
      momentumScore: momentum.score,
      volumeScore: scoreVolumeFromSnapshot(primary),
    });

    const triggered = strategies.filter((s) => {
      if (!s.triggered) return false;
      if (!config.strategyId || config.strategyId === 'ALL') return true;
      return s.strategyId === config.strategyId;
    });
    if (triggered.length > 0) signalsGenerated += 1;

    const open = account.positions.find((p) => p.tokenAddress === tokenAddress);
    if (open) {
      const stop = open.trailingStop ?? open.stopLoss;
      if (candle.low <= stop) {
        ({ account } = processPriceUpdate(account, tokenAddress, stop * 0.999, paperCfg));
      } else {
        ({ account } = processPriceUpdate(account, tokenAddress, candle.high, paperCfg));
        if (account.positions.some((p) => p.tokenAddress === tokenAddress)) {
          ({ account } = processPriceUpdate(account, tokenAddress, candle.close, paperCfg));
        }
      }
    }

    const hasOpen = account.positions.some((p) => p.tokenAddress === tokenAddress);
    const canEnter =
      !hasOpen &&
      triggered.length > 0 &&
      !momentum.exhaustion &&
      primary.trend !== 'BEARISH' &&
      i - lastEntryBar >= config.minBarsBetweenEntries &&
      primary.price != null &&
      (primary.atr != null || primary.price > 0);

    if (canEnter) {
      const best = [...triggered].sort((a, b) => b.confidence - a.confidence)[0]!;
      const levels = calculateTradeLevels({
        currentPrice: primary.price!,
        atr: primary.atr ?? primary.price! * 0.03,
        support: primary.support,
        swingLow: primary.support,
      });
      const tech = scoreTechnicalFromSnapshot(primary);
      if (tech >= 55 && levels.riskReward >= 1.2) {
        const opened = openPaperPosition(account, {
          tokenAddress,
          symbol,
          entryPrice: levels.idealEntry,
          stopLoss: levels.stopLoss,
          tp1Price: levels.tp1Price,
          tp2Price: levels.tp2Price,
          strategy: best.name,
          entryReason: best.reason,
          atr: primary.atr,
          trailingEnabled: true,
          config: paperCfg,
        });
        if (opened.position) {
          account = opened.account;
          entriesTaken += 1;
          lastEntryBar = i;
          opened.position.openedAt = new Date(candle.time * 1000).toISOString();
        }
      }
    }
  }

  const last = candles[candles.length - 1];
  if (last && account.positions.length > 0) {
    account = forceCloseRemaining(account, last.close, paperCfg);
  }

  const trades = toTradeSummaries(account);
  const performance = computePaperPerformance(account);

  return {
    label,
    bars: candles.length,
    performance,
    trades,
    signalsGenerated,
    entriesTaken,
  };
}

export function runBacktest(
  candles: Candle[],
  configPartial?: Partial<BacktestConfig>,
): BacktestResult {
  const config: BacktestConfig = {
    startingBalance: 1000,
    timeframe: '5m',
    strategyId: 'ALL',
    warmupBars: 60,
    outOfSamplePct: 0.3,
    minBarsBetweenEntries: 5,
    ...configPartial,
  };

  if (candles.length < config.warmupBars + 20) {
    throw new Error(
      `Not enough candles for backtest (${candles.length}). Need at least ${config.warmupBars + 20}.`,
    );
  }

  const { inSample, outOfSample } = splitCandles(candles, config.outOfSamplePct);

  return {
    config,
    inSample: runSegment(inSample, config, 'IN_SAMPLE'),
    outOfSample: runSegment(outOfSample, config, 'OUT_OF_SAMPLE'),
    full: runSegment(candles, config, 'FULL'),
    warning:
      'Backtests can overfit. Prefer out-of-sample results. Past results do not guarantee future performance. Not financial advice.',
    generatedAt: new Date().toISOString(),
  };
}

export type SignalOutcomeInput = {
  entryPrice: number;
  stopLoss: number;
  tp1Price: number;
  tp2Price: number;
  signalTime: number;
  candles: Candle[];
};

export type SignalOutcome = {
  tp1Hit: boolean;
  tp2Hit: boolean;
  slHit: boolean;
  mfePct: number;
  maePct: number;
  timeToTp1Sec: number | null;
  timeToTp2Sec: number | null;
  timeToStopSec: number | null;
  firstExit: 'TP1' | 'TP2' | 'SL' | 'NONE';
  resolved: boolean;
};

export function trackSignalOutcome(input: SignalOutcomeInput): SignalOutcome {
  const future = input.candles.filter((c) => c.time >= input.signalTime);
  let mfe = 0;
  let mae = 0;
  let tp1Hit = false;
  let tp2Hit = false;
  let slHit = false;
  let timeToTp1Sec: number | null = null;
  let timeToTp2Sec: number | null = null;
  let timeToStopSec: number | null = null;
  let firstExit: SignalOutcome['firstExit'] = 'NONE';

  for (const c of future) {
    const highPct = ((c.high - input.entryPrice) / input.entryPrice) * 100;
    const lowPct = ((c.low - input.entryPrice) / input.entryPrice) * 100;
    mfe = Math.max(mfe, highPct);
    mae = Math.min(mae, lowPct);
    const elapsed = c.time - input.signalTime;

    if (!slHit && firstExit === 'NONE' && c.low <= input.stopLoss) {
      slHit = true;
      timeToStopSec = elapsed;
      firstExit = 'SL';
      break;
    }
    if (!tp1Hit && c.high >= input.tp1Price) {
      tp1Hit = true;
      timeToTp1Sec = elapsed;
      if (firstExit === 'NONE') firstExit = 'TP1';
    }
    if (!tp2Hit && c.high >= input.tp2Price) {
      tp2Hit = true;
      timeToTp2Sec = elapsed;
      if (firstExit === 'NONE') firstExit = 'TP2';
    }
  }

  return {
    tp1Hit,
    tp2Hit,
    slHit,
    mfePct: mfe,
    maePct: mae,
    timeToTp1Sec,
    timeToTp2Sec,
    timeToStopSec,
    firstExit,
    resolved: tp1Hit || tp2Hit || slHit,
  };
}
