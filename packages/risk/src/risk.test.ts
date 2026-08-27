import { describe, expect, it } from 'vitest';
import {
  evaluateRiskLimits,
  positionSizeUsd,
  updateTrailingStop,
} from './index';

describe('positionSizeUsd', () => {
  it('sizes by risk amount / stop distance', () => {
    const size = positionSizeUsd({
      accountBalance: 1000,
      riskPct: 1,
      entry: 1,
      stopLoss: 0.9,
    });
    expect(size).toBeCloseTo(100);
  });
});

describe('evaluateRiskLimits', () => {
  it('blocks when daily loss limit hit', () => {
    const result = evaluateRiskLimits({
      accountBalance: 900,
      startingBalance: 1000,
      openPositions: 0,
      dailyTrades: 1,
      dailyRealizedPnl: -60,
      consecutiveLosses: 0,
      currentExposureUsd: 0,
      proposedSizeUsd: 50,
      maxDailyLossPct: 5,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/daily loss/i);
  });
});

describe('updateTrailingStop', () => {
  it('never moves trailing stop backward for longs', () => {
    const next = updateTrailingStop({
      method: 'PERCENT',
      side: 'long',
      currentStop: 1.1,
      price: 1.05,
      trailPct: 8,
    });
    expect(next).toBe(1.1);
  });

  it('raises stop as price advances', () => {
    const next = updateTrailingStop({
      method: 'PERCENT',
      side: 'long',
      currentStop: 1.0,
      price: 1.2,
      trailPct: 10,
    });
    expect(next).toBeCloseTo(1.08);
  });
});
