import type { TokenAnalysisInput } from './types';
import { clampScore } from './trades';

export type TokenComponentScores = {
  liquidity: number;
  volume: number;
  holders: number;
  pressure: number;
  technical5m: number;
  trend15m: number;
};

export function analyzeTokenMarket(input: TokenAnalysisInput): TokenComponentScores {
  return {
    liquidity: scoreLiquidity(input),
    volume: scoreVolume(input),
    holders: scoreHolders(input),
    pressure: scorePressure(input),
    technical5m: scoreTechnical5m(input),
    trend15m: input.trend15mBullish ? 78 : 38,
  };
}

function scoreLiquidity(input: TokenAnalysisInput): number {
  const liq = input.liquidityUsd;
  let score = 30;
  if (liq == null) return 30;
  if (liq >= 250_000) score = 88;
  else if (liq >= 80_000) score = 75;
  else if (liq >= 25_000) score = 62;
  else if (liq >= 10_000) score = 40;
  else score = 18;
  if ((input.liquidityGrowthPct ?? 0) > 15) score += 8;
  if ((input.liquidityGrowthPct ?? 0) < -25) score -= 18;
  if (input.liquidityLockedOrBurned) score += 6;
  if ((input.top10Pct ?? 0) > 45) score -= 10;
  return clampScore(score);
}

function scoreVolume(input: TokenAnalysisInput): number {
  let score = 40;
  const v5 = input.volume5m ?? 0;
  const v15 = input.volume15m ?? 0;
  const v1 = input.volume1m ?? 0;
  if (v5 > 0 && input.liquidityUsd) {
    const churn = v5 / Math.max(input.liquidityUsd, 1);
    if (churn >= 0.02 && churn <= 0.4) score += 18;
    else if (churn > 0.8) score -= 10;
  }
  if (v15 > 0 && v5 > v15 / 3 * 1.25) score += 12;
  if (v1 > 0 && v5 > 0 && v1 > v5 / 5 * 1.4) score += 10;
  if (input.volumeExpansion) score += 10;
  if (input.hugeSingleCandle) score -= 16;
  return clampScore(score);
}

function scoreHolders(input: TokenAnalysisInput): number {
  let score = 40;
  if ((input.holderGrowthPct ?? 0) >= 8) score += 20;
  else if ((input.holderGrowthPct ?? 0) >= 3) score += 10;
  else if ((input.holderGrowthPct ?? 0) < -5) score -= 15;
  if ((input.newWalletGrowthPct ?? 0) >= 10) score += 10;
  if ((input.top10Pct ?? 0) >= 50) score -= 20;
  else if ((input.top10Pct ?? 0) <= 25) score += 8;
  if ((input.holderCount ?? 0) >= 400) score += 8;
  return clampScore(score);
}

function scorePressure(input: TokenAnalysisInput): number {
  const buys = (input.buys5m ?? 0) + (input.buys1m ?? 0);
  const sells = (input.sells5m ?? 0) + (input.sells1m ?? 0);
  if (buys + sells <= 0) return 45;
  const ratio = buys / Math.max(sells, 1);
  let score = 50;
  if (ratio >= 1.8) score = 82;
  else if (ratio >= 1.25) score = 70;
  else if (ratio < 0.7) score = 28;
  else if (ratio < 1) score = 42;
  return clampScore(score);
}

function scoreTechnical5m(input: TokenAnalysisInput): number {
  let score = input.technical5m;
  if (input.higherHighs && input.higherLows) score += 8;
  if (input.breakout && input.volumeExpansion) score += 6;
  if (input.hugeSingleCandle && !input.higherLows) score -= 18;
  return clampScore(score);
}
