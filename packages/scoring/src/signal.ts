import { DEFAULT_RISK, SIGNAL_WEIGHTS, SignalType } from '@memecoinbot/shared';
import type { IndicatorSnapshot } from '@memecoinbot/indicators';
import type { StrategyResult } from '@memecoinbot/strategies';

export type SignalWeights = {
  safety: number;
  momentum: number;
  volume: number;
  technicalStructure: number;
  liquidity: number;
  onChainConfirmation: number;
};

export type SignalScoreInput = {
  safetyScore: number;
  momentumScore: number;
  volumeScore: number;
  technicalScore: number;
  liquidityScore: number;
  onChainScore: number;
  weights?: Partial<SignalWeights>;
};

export type TradeLevels = {
  currentPrice: number;
  idealEntry: number;
  entryMin: number;
  entryMax: number;
  maxAcceptableEntry: number;
  invalidationPrice: number;
  stopLoss: number;
  stopLossPct: number;
  tp1Price: number;
  tp2Price: number;
  tp1Pct: number;
  tp2Pct: number;
  tp1SellPct: number;
  tp2SellPct: number;
  remainingPct: number;
  riskReward: number;
  entryValid: boolean;
  entryStatus: 'VALID' | 'ENTRY_INVALIDATED';
  stopReason: string;
};

export type BuyGateInput = {
  safetyScore: number;
  signalScore: number;
  safetyMin?: number;
  signalMin?: number;
  liquidityUsd: number | null;
  minLiquidityUsd?: number;
  criticalWarning: boolean;
  dataConflict?: boolean;
  riskReward: number;
  minRiskReward?: number;
  entryValid: boolean;
  marketDataCurrent?: boolean;
  extremeFomo?: boolean;
  highRiskPump?: boolean;
  independentAgreeing?: number;
  independentRequired?: number;
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function mergeSignalWeights(partial?: Partial<SignalWeights>): SignalWeights {
  const merged: SignalWeights = {
    safety: partial?.safety ?? SIGNAL_WEIGHTS.safety,
    momentum: partial?.momentum ?? SIGNAL_WEIGHTS.momentum,
    volume: partial?.volume ?? SIGNAL_WEIGHTS.volume,
    technicalStructure:
      partial?.technicalStructure ?? SIGNAL_WEIGHTS.technicalStructure,
    liquidity: partial?.liquidity ?? SIGNAL_WEIGHTS.liquidity,
    onChainConfirmation:
      partial?.onChainConfirmation ?? SIGNAL_WEIGHTS.onChainConfirmation,
  };
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...SIGNAL_WEIGHTS };
  return {
    safety: merged.safety / sum,
    momentum: merged.momentum / sum,
    volume: merged.volume / sum,
    technicalStructure: merged.technicalStructure / sum,
    liquidity: merged.liquidity / sum,
    onChainConfirmation: merged.onChainConfirmation / sum,
  };
}

export function scoreVolumeFromSnapshot(snapshot: IndicatorSnapshot): number {
  let score = 40;
  if (snapshot.volumeExpansion) score += 30;
  if (snapshot.volume != null && snapshot.volumeMa != null) {
    const ratio = snapshot.volume / Math.max(snapshot.volumeMa, 1e-9);
    if (ratio >= 2) score += 15;
    else if (ratio >= 1.2) score += 8;
    else if (ratio < 0.7) score -= 15;
  }
  return clamp(score);
}

export function scoreTechnicalFromSnapshot(snapshot: IndicatorSnapshot): number {
  let score = 35;
  if (snapshot.bullishEmaStack) score += 20;
  if (snapshot.aboveVwap) score += 10;
  if (snapshot.trend === 'BULLISH') score += 15;
  if (snapshot.higherHighs && snapshot.higherLows) score += 15;
  if (snapshot.breakout || snapshot.breakoutRetest) score += 10;
  if ((snapshot.macdHistogram ?? 0) > 0) score += 5;
  if (snapshot.rsi != null && snapshot.rsi > 75) score -= 15;
  if (snapshot.trend === 'BEARISH') score -= 25;
  return clamp(score);
}

export function scoreLiquidityUsd(liquidityUsd: number | null, min = 25_000): number {
  if (liquidityUsd == null) return 30;
  if (liquidityUsd >= min * 4) return 100;
  if (liquidityUsd >= min * 2) return 85;
  if (liquidityUsd >= min) return 75;
  if (liquidityUsd >= min * 0.5) return 45;
  return 20;
}

export function computeSignalScore(input: SignalScoreInput): {
  signalScore: number;
  weights: SignalWeights;
} {
  const weights = mergeSignalWeights(input.weights);
  const signalScore = clamp(
    input.safetyScore * weights.safety +
      input.momentumScore * weights.momentum +
      input.volumeScore * weights.volume +
      input.technicalScore * weights.technicalStructure +
      input.liquidityScore * weights.liquidity +
      input.onChainScore * weights.onChainConfirmation,
  );
  return { signalScore, weights };
}

export function calculateTradeLevels(params: {
  currentPrice: number;
  atr: number | null;
  support: number | null;
  swingLow?: number | null;
  tp1Pct?: number;
  tp2Pct?: number;
  tp1SellPct?: number;
  tp2SellPct?: number;
  remainingPct?: number;
  atrMultiplier?: number;
}): TradeLevels {
  const price = params.currentPrice;
  const atr = params.atr && params.atr > 0 ? params.atr : price * 0.03;
  const atrMult = params.atrMultiplier ?? 1.5;

  const atrStop = price - atr * atrMult;
  const supportStop = params.support != null ? params.support * 0.995 : atrStop;
  const swingStop =
    params.swingLow != null ? params.swingLow * 0.995 : atrStop;
  const stopLoss = Math.min(atrStop, supportStop, swingStop);
  const stopLossPct = ((price - stopLoss) / price) * 100;

  const idealEntry = price;
  const entryRange = Math.max(atr * 0.35, price * 0.004);
  const entryMin = price - entryRange;
  const entryMax = price + entryRange;
  const maxAcceptableEntry = entryMax;
  const invalidationPrice = stopLoss;

  const tp1Pct = params.tp1Pct ?? DEFAULT_RISK.tp1Pct;
  const tp2Pct = params.tp2Pct ?? DEFAULT_RISK.tp2Pct;
  const tp1Price = price * (1 + tp1Pct / 100);
  const tp2Price = price * (1 + tp2Pct / 100);
  const risk = price - stopLoss;
  const reward = tp1Price - price;
  const riskReward = risk > 0 ? reward / risk : 0;

  return {
    currentPrice: price,
    idealEntry,
    entryMin,
    entryMax,
    maxAcceptableEntry,
    invalidationPrice,
    stopLoss,
    stopLossPct,
    tp1Price,
    tp2Price,
    tp1Pct,
    tp2Pct,
    tp1SellPct: params.tp1SellPct ?? DEFAULT_RISK.tp1SellPct,
    tp2SellPct: params.tp2SellPct ?? DEFAULT_RISK.tp2SellPct,
    remainingPct: params.remainingPct ?? DEFAULT_RISK.remainingPct,
    riskReward,
    entryValid: true,
    entryStatus: 'VALID',
    stopReason: 'ATR + support/swing hybrid stop',
  };
}

export function validateEntryPrice(
  levels: TradeLevels,
  livePrice: number,
): TradeLevels {
  if (livePrice > levels.maxAcceptableEntry) {
    return {
      ...levels,
      currentPrice: livePrice,
      entryValid: false,
      entryStatus: 'ENTRY_INVALIDATED',
    };
  }
  return {
    ...levels,
    currentPrice: livePrice,
    entryValid: true,
    entryStatus: 'VALID',
  };
}

export function evaluateBuyGates(input: BuyGateInput): {
  canBuy: boolean;
  signalType: SignalType;
  failedChecks: string[];
} {
  const failed: string[] = [];
  const safetyMin = input.safetyMin ?? DEFAULT_RISK.safetyMin;
  const signalMin = input.signalMin ?? DEFAULT_RISK.signalMin;
  const minLiq = input.minLiquidityUsd ?? 25_000;
  const minRr = input.minRiskReward ?? DEFAULT_RISK.minRiskReward;

  if (input.criticalWarning) failed.push('Critical security warning');
  if (input.dataConflict) failed.push('DATA CONFLICT');
  if (input.safetyScore < safetyMin) failed.push(`Safety ${input.safetyScore} < ${safetyMin}`);
  if (input.signalScore < signalMin) failed.push(`Signal ${input.signalScore} < ${signalMin}`);
  if ((input.liquidityUsd ?? 0) < minLiq) failed.push('Inadequate liquidity');
  if (input.riskReward < minRr) {
    failed.push(`R:R ${input.riskReward.toFixed(2)} < ${minRr}`);
  }
  if (input.extremeFomo) failed.push('Extreme FOMO — do not chase');
  if (input.highRiskPump) failed.push('High-risk pump');
  if (
    input.independentRequired != null &&
    (input.independentAgreeing ?? 0) < input.independentRequired
  ) {
    failed.push(
      `Independent signals ${input.independentAgreeing ?? 0} < ${input.independentRequired}`,
    );
  }
  if (!input.entryValid) failed.push('ENTRY INVALIDATED');
  if (input.marketDataCurrent === false) failed.push('Market data stale/unavailable');

  if (failed.length > 0) {
    return { canBuy: false, signalType: SignalType.NO_TRADE, failedChecks: failed };
  }
  return { canBuy: true, signalType: SignalType.BUY, failedChecks: [] };
}

export function pickSignalType(params: {
  canBuy: boolean;
  signalScore: number;
  strategiesTriggered: number;
  exhaustion: boolean;
}): SignalType {
  if (params.canBuy) return SignalType.BUY;
  if (params.exhaustion && params.signalScore >= 60) return SignalType.WATCH;
  if (params.strategiesTriggered > 0 && params.signalScore >= 65) {
    return SignalType.SETUP_FORMING;
  }
  if (params.signalScore >= 55) return SignalType.WATCH;
  return SignalType.NO_TRADE;
}

export function buildBeginnerSignalExplain(params: {
  signalType: SignalType;
  checks: string[];
  failedChecks: string[];
  strategy?: StrategyResult | null;
  levels: TradeLevels;
}): {
  whatBotSees: string[];
  whyItLikes: string[];
  whatCouldGoWrong: string[];
  decision: string;
} {
  return {
    whatBotSees: params.checks,
    whyItLikes: params.failedChecks.length
      ? params.failedChecks.map((f) => `Failed: ${f}`)
      : [
          params.strategy?.reason ?? 'Configured filters passed',
          `Entry ${params.levels.entryMin.toPrecision(4)}–${params.levels.entryMax.toPrecision(4)}`,
          `SL ${params.levels.stopLoss.toPrecision(4)} (${params.levels.stopLossPct.toFixed(1)}%)`,
          `TP1 +${params.levels.tp1Pct}% / TP2 +${params.levels.tp2Pct}%`,
        ],
    whatCouldGoWrong: [
      'Meme coins are highly volatile.',
      'Momentum can reverse quickly.',
      'Liquidity can disappear.',
      'Technical signals can fail.',
      'This is not a guarantee.',
    ],
    decision:
      params.signalType === SignalType.BUY
        ? 'BUY SETUP (potential only) — independent signals agreed and hard gates passed'
        : params.signalType === SignalType.NO_TRADE
          ? params.failedChecks.length
            ? `NO TRADE — ${params.failedChecks.join('; ')}`
            : 'NO TRADE'
          : params.signalType,
  };
}
