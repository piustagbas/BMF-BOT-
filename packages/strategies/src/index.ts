import { StrategyId } from '@memecoinbot/shared';
import type { IndicatorSnapshot } from '@memecoinbot/indicators';

export interface StrategyContext {
  primary: IndicatorSnapshot;
  confirmation?: IndicatorSnapshot | null;
  momentumScore: number;
  volumeScore: number;
}

export interface StrategyResult {
  strategyId: StrategyId;
  name: string;
  triggered: boolean;
  confidence: number;
  reason: string;
  invalidation: string;
}

export type StrategyThresholds = {
  rsiMax?: number;
  volumeExpansionRequired?: boolean;
};

export const STRATEGY_IDS = Object.values(StrategyId);

function mtfBullish(ctx: StrategyContext): boolean {
  if (!ctx.confirmation) return true;
  return (
    ctx.confirmation.trend !== 'BEARISH' &&
    (ctx.confirmation.bullishEmaStack || ctx.confirmation.aboveVwap)
  );
}

export function evaluateMomentumBreakout(
  ctx: StrategyContext,
  _thresholds: StrategyThresholds = {},
): StrategyResult {
  const p = ctx.primary;
  const triggered =
    p.breakout &&
    p.volumeExpansion &&
    p.trend === 'BULLISH' &&
    p.aboveVwap &&
    mtfBullish(ctx) &&
    (p.rsi == null || p.rsi < (_thresholds.rsiMax ?? 78));

  return {
    strategyId: StrategyId.MOMENTUM_BREAKOUT,
    name: 'Momentum Breakout',
    triggered,
    confidence: triggered ? 75 + (p.volumeExpansion ? 10 : 0) : 20,
    reason: triggered
      ? 'Breakout with volume expansion, bullish structure, price above VWAP'
      : 'Momentum breakout conditions not met',
    invalidation: 'Close back below breakout level or VWAP loss with volume',
  };
}

export function evaluateBreakoutRetest(ctx: StrategyContext): StrategyResult {
  const p = ctx.primary;
  const triggered =
    p.breakoutRetest &&
    p.higherLows &&
    p.aboveVwap &&
    mtfBullish(ctx);

  return {
    strategyId: StrategyId.BREAKOUT_RETEST,
    name: 'Breakout + Retest',
    triggered,
    confidence: triggered ? 80 : 25,
    reason: triggered
      ? 'Breakout retested and held with higher lows'
      : 'No valid breakout/retest confirmation',
    invalidation: 'Retest fails and closes below reclaimed level',
  };
}

export function evaluateEmaTrendContinuation(ctx: StrategyContext): StrategyResult {
  const p = ctx.primary;
  const triggered =
    p.bullishEmaStack &&
    p.aboveVwap &&
    p.trend === 'BULLISH' &&
    p.higherHighs &&
    p.higherLows &&
    mtfBullish(ctx) &&
    (p.rsi == null || (p.rsi > 45 && p.rsi < 72));

  return {
    strategyId: StrategyId.EMA_TREND_CONTINUATION,
    name: 'EMA Trend Continuation',
    triggered,
    confidence: triggered ? 78 : 22,
    reason: triggered
      ? 'EMA 9>21>50 stack with bullish HH/HL structure'
      : 'EMA trend continuation not confirmed',
    invalidation: 'EMA stack breaks (close below EMA21) or HL fails',
  };
}

export function evaluateVwapReclaim(ctx: StrategyContext): StrategyResult {
  const p = ctx.primary;
  const histUp = (p.macdHistogram ?? 0) > 0;
  const triggered =
    p.aboveVwap &&
    p.ema9 != null &&
    p.price != null &&
    p.price >= p.ema9 &&
    histUp &&
    !p.lowerLows &&
    mtfBullish(ctx);

  return {
    strategyId: StrategyId.VWAP_RECLAIM,
    name: 'VWAP Reclaim',
    triggered,
    confidence: triggered ? 72 : 18,
    reason: triggered
      ? 'Price reclaimed VWAP with rising MACD histogram'
      : 'VWAP reclaim conditions not met',
    invalidation: 'Loss of VWAP on expanding sell volume',
  };
}

export function evaluateVolumeExpansion(ctx: StrategyContext): StrategyResult {
  const p = ctx.primary;
  const triggered =
    p.volumeExpansion &&
    p.aboveVwap &&
    (p.breakout || p.bullishEmaStack) &&
    ctx.momentumScore >= 55 &&
    mtfBullish(ctx);

  return {
    strategyId: StrategyId.VOLUME_EXPANSION,
    name: 'Volume Expansion',
    triggered,
    confidence: triggered ? 70 : 15,
    reason: triggered
      ? 'Volume expansion with bullish confirmation (volume alone is never enough)'
      : 'Volume expansion without required confirmation',
    invalidation: 'Volume fade with bearish close under VWAP',
  };
}

export function evaluateStrategies(
  ctx: StrategyContext,
  thresholds: StrategyThresholds = {},
): StrategyResult[] {
  return [
    evaluateMomentumBreakout(ctx, thresholds),
    evaluateBreakoutRetest(ctx),
    evaluateEmaTrendContinuation(ctx),
    evaluateVwapReclaim(ctx),
    evaluateVolumeExpansion(ctx),
  ];
}

export function analyzeMomentum(snapshot: IndicatorSnapshot): {
  score: number;
  notes: string[];
  exhaustion: boolean;
} {
  const notes: string[] = [];
  let score = 40;

  if (snapshot.volumeExpansion) {
    score += 15;
    notes.push('Volume expansion');
  }
  if (snapshot.bullishEmaStack) {
    score += 15;
    notes.push('Bullish EMA stack');
  }
  if (snapshot.aboveVwap) {
    score += 10;
    notes.push('Price above VWAP');
  }
  if (snapshot.breakout) {
    score += 10;
    notes.push('Breakout');
  }
  if (snapshot.breakoutRetest) {
    score += 8;
    notes.push('Breakout retest');
  }
  if (snapshot.higherHighs && snapshot.higherLows) {
    score += 12;
    notes.push('HH/HL structure');
  }
  if ((snapshot.macdHistogram ?? 0) > 0) {
    score += 5;
    notes.push('MACD histogram positive');
  }

  const exhaustion =
    (snapshot.rsi != null && snapshot.rsi >= 80) ||
    (snapshot.volumeExpansion && snapshot.rsi != null && snapshot.rsi >= 75);

  if (exhaustion) {
    score -= 35;
    notes.push('Momentum exhaustion risk');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    notes,
    exhaustion,
  };
}
