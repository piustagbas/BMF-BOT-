import { MEME_COIN_SCORE_WEIGHTS, MemeSignalLevel } from '@memecoinbot/shared';
import type { ConsensusEvent, MemeCoinScoreWeights, MemeScoreBreakdown } from './types';
import { detectRisk, riskToScore, type RiskDetectorInput } from './risk-detector';
import { analyzeTokenMarket } from './token-analyzer';
import type { TokenAnalysisInput } from './types';
import { clampScore } from './trades';

export function mergeMemeWeights(
  partial?: Partial<MemeCoinScoreWeights>,
): MemeCoinScoreWeights {
  const merged: MemeCoinScoreWeights = {
    smartMoney: partial?.smartMoney ?? MEME_COIN_SCORE_WEIGHTS.smartMoney,
    liquidity: partial?.liquidity ?? MEME_COIN_SCORE_WEIGHTS.liquidity,
    volume: partial?.volume ?? MEME_COIN_SCORE_WEIGHTS.volume,
    holders: partial?.holders ?? MEME_COIN_SCORE_WEIGHTS.holders,
    pressure: partial?.pressure ?? MEME_COIN_SCORE_WEIGHTS.pressure,
    technical5m: partial?.technical5m ?? MEME_COIN_SCORE_WEIGHTS.technical5m,
    trend15m: partial?.trend15m ?? MEME_COIN_SCORE_WEIGHTS.trend15m,
    risk: partial?.risk ?? MEME_COIN_SCORE_WEIGHTS.risk,
  };
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...MEME_COIN_SCORE_WEIGHTS };
  return {
    smartMoney: merged.smartMoney / sum,
    liquidity: merged.liquidity / sum,
    volume: merged.volume / sum,
    holders: merged.holders / sum,
    pressure: merged.pressure / sum,
    technical5m: merged.technical5m / sum,
    trend15m: merged.trend15m / sum,
    risk: merged.risk / sum,
  };
}

export function memeSignalLevel(score: number): MemeSignalLevel {
  if (score >= 90) return MemeSignalLevel.VERY_STRONG;
  if (score >= 80) return MemeSignalLevel.STRONG;
  if (score >= 70) return MemeSignalLevel.WATCH;
  if (score >= 60) return MemeSignalLevel.WEAK;
  return MemeSignalLevel.AVOID;
}

export type MemeSignalResult = {
  overall: number;
  level: MemeSignalLevel;
  breakdown: MemeScoreBreakdown;
  consensus: ConsensusEvent | null;
  risk: ReturnType<typeof detectRisk>;
  confirmation: {
    smartMoneyAccumulation: boolean;
    volumeExpansion: boolean;
    structure5m: boolean;
    trend15m: boolean;
    healthyLiquidity: boolean;
    holderGrowth: boolean;
    acceptableRisk: boolean;
  };
  downgraded: boolean;
  canEmitBuy: boolean;
  reason: string;
};

export function computeMemeCoinScore(params: {
  consensus: ConsensusEvent | null;
  token: TokenAnalysisInput;
  risk: RiskDetectorInput;
  weights?: Partial<MemeCoinScoreWeights>;
}): MemeSignalResult {
  const market = analyzeTokenMarket(params.token);
  const risk = detectRisk(params.risk);
  const riskScore = riskToScore(risk);
  const sm = params.consensus
    ? clampScore(params.consensus.strength)
    : 28;

  const w = mergeMemeWeights(params.weights);
  const breakdown: MemeScoreBreakdown = {
    overall: 0,
    smartMoney: sm,
    liquidity: market.liquidity,
    volume: market.volume,
    holders: market.holders,
    pressure: market.pressure,
    technical5m: market.technical5m,
    trend15m: market.trend15m,
    risk: riskScore,
  };

  let overall =
    breakdown.smartMoney * w.smartMoney +
    breakdown.liquidity * w.liquidity +
    breakdown.volume * w.volume +
    breakdown.holders * w.holders +
    breakdown.pressure * w.pressure +
    breakdown.technical5m * w.technical5m +
    breakdown.trend15m * w.trend15m +
    breakdown.risk * w.risk;

  const deteriorating =
    Boolean(params.consensus) &&
    (market.liquidity < 40 || market.technical5m < 40 || risk.severity === 'HIGH');
  if (deteriorating) overall -= 18;

  if (risk.severity === 'HIGH') overall = Math.min(overall, 55);
  if (params.token.hugeSingleCandle && !params.token.higherLows) overall -= 8;

  overall = clampScore(overall);
  breakdown.overall = overall;

  const confirmation = {
    smartMoneyAccumulation: (params.consensus?.independentWallets ?? 0) >= 3,
    volumeExpansion: params.token.volumeExpansion,
    structure5m: params.token.higherHighs && params.token.higherLows,
    trend15m: params.token.trend15mBullish,
    healthyLiquidity: (params.token.liquidityUsd ?? 0) >= 25_000,
    holderGrowth: (params.token.holderGrowthPct ?? 0) > 0,
    acceptableRisk: risk.severity !== 'HIGH',
  };

  const confirms = Object.values(confirmation).filter(Boolean).length;
  let level = memeSignalLevel(overall);
  let canEmitBuy = overall >= 80 && confirms >= 5 && confirmation.acceptableRisk;
  if (overall < 60) {
    level = MemeSignalLevel.AVOID;
    canEmitBuy = false;
  }

  const reasonParts: string[] = [];
  if (params.consensus) reasonParts.push(params.consensus.reason);
  else reasonParts.push('No independent smart-money consensus yet');
  if (deteriorating) {
    reasonParts.push('Smart-money flow is not confirmed by liquidity/structure — score downgraded');
  }
  if (risk.reasons[0]) reasonParts.push(risk.reasons[0]);
  reasonParts.push('This is not a copy-trade. Wallet buys are one input, not a BUY by themselves.');

  return {
    overall,
    level,
    breakdown,
    consensus: params.consensus,
    risk,
    confirmation,
    downgraded: deteriorating,
    canEmitBuy,
    reason: reasonParts.join(' '),
  };
}
