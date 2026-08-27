import { DEFAULT_RISK } from '@memecoinbot/shared';

export function positionSizeUsd(params: {
  accountBalance: number;
  riskPct?: number;
  entry: number;
  stopLoss: number;
  maxPositionPct?: number;
}): number {
  const riskPct = params.riskPct ?? DEFAULT_RISK.riskPerTradePct;
  const distance = Math.abs(params.entry - params.stopLoss);
  if (distance <= 0 || params.entry <= 0 || params.accountBalance <= 0) return 0;
  const riskAmount = params.accountBalance * (riskPct / 100);
  const units = riskAmount / distance;
  let size = units * params.entry;
  const maxPct = params.maxPositionPct ?? 20;
  const maxSize = params.accountBalance * (maxPct / 100);
  return Math.min(size, maxSize);
}

export function dollarRisk(params: {
  entry: number;
  stopLoss: number;
  positionSizeUsd: number;
}): number {
  if (params.entry <= 0) return 0;
  const pct = Math.abs(params.entry - params.stopLoss) / params.entry;
  return params.positionSizeUsd * pct;
}

export type RiskLimitInput = {
  accountBalance: number;
  startingBalance: number;
  openPositions: number;
  dailyTrades: number;
  dailyRealizedPnl: number;
  consecutiveLosses: number;
  currentExposureUsd: number;
  proposedSizeUsd: number;
  maxDailyLossPct?: number;
  maxOpenPositions?: number;
  maxDailyTrades?: number;
  maxExposurePct?: number;
  maxConsecutiveLosses?: number;
};

export type RiskLimitResult = {
  allowed: boolean;
  reasons: string[];
};

export function evaluateRiskLimits(input: RiskLimitInput): RiskLimitResult {
  const reasons: string[] = [];
  const maxDailyLossPct = input.maxDailyLossPct ?? 5;
  const maxOpen = input.maxOpenPositions ?? DEFAULT_RISK.maxOpenPositions;
  const maxDailyTrades = input.maxDailyTrades ?? DEFAULT_RISK.maxDailyTrades;
  const maxExposurePct = input.maxExposurePct ?? 50;
  const maxConsecutive =
    input.maxConsecutiveLosses ?? DEFAULT_RISK.maxConsecutiveLosses;

  const dailyLossPct =
    input.startingBalance > 0
      ? (-input.dailyRealizedPnl / input.startingBalance) * 100
      : 0;

  if (input.dailyRealizedPnl < 0 && dailyLossPct >= maxDailyLossPct) {
    reasons.push('Maximum daily loss reached — NO NEW TRADES');
  }
  if (input.openPositions >= maxOpen) {
    reasons.push('Maximum open positions reached — NO NEW TRADES');
  }
  if (input.dailyTrades >= maxDailyTrades) {
    reasons.push('Maximum daily trades reached — NO NEW TRADES');
  }
  if (input.consecutiveLosses >= maxConsecutive) {
    reasons.push('Maximum consecutive losses reached — NO NEW TRADES');
  }
  const exposure =
    input.currentExposureUsd + input.proposedSizeUsd;
  const exposurePct =
    input.accountBalance > 0 ? (exposure / input.accountBalance) * 100 : 100;
  if (exposurePct > maxExposurePct) {
    reasons.push('Maximum account exposure exceeded — NO NEW TRADES');
  }
  if (input.proposedSizeUsd <= 0) {
    reasons.push('Invalid position size');
  }

  return { allowed: reasons.length === 0, reasons };
}

export type TrailingMethod = 'ATR' | 'PERCENT' | 'SWING_LOW';

export function updateTrailingStop(params: {
  method: TrailingMethod;
  side: 'long';
  currentStop: number;
  price: number;
  atr?: number | null;
  atrMult?: number;
  trailPct?: number;
  swingLow?: number | null;
}): number {
  const { price, currentStop } = params;
  let candidate = currentStop;

  if (params.method === 'ATR') {
    const atr = params.atr && params.atr > 0 ? params.atr : price * 0.02;
    candidate = price - atr * (params.atrMult ?? 2);
  } else if (params.method === 'PERCENT') {
    const pct = params.trailPct ?? 8;
    candidate = price * (1 - pct / 100);
  } else if (params.method === 'SWING_LOW' && params.swingLow != null) {
    candidate = params.swingLow;
  }

  // Trailing stop only moves in the profitable direction (up for longs)
  return Math.max(currentStop, candidate);
}
