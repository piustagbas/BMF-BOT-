import { describe, expect, it } from 'vitest';
import { SignalType } from '@memecoinbot/shared';
import {
  calculateTradeLevels,
  computeSignalScore,
  evaluateBuyGates,
  validateEntryPrice,
} from './signal';

describe('computeSignalScore', () => {
  it('weights components into 0-100 score', () => {
    const { signalScore } = computeSignalScore({
      safetyScore: 90,
      momentumScore: 80,
      volumeScore: 70,
      technicalScore: 75,
      liquidityScore: 80,
      onChainScore: 60,
    });
    expect(signalScore).toBeGreaterThan(70);
    expect(signalScore).toBeLessThanOrEqual(100);
  });
});

describe('trade levels', () => {
  it('builds SL TP1 TP2 and invalidates chase entries', () => {
    const levels = calculateTradeLevels({
      currentPrice: 1,
      atr: 0.05,
      support: 0.9,
      tp1Pct: 30,
      tp2Pct: 60,
    });
    expect(levels.stopLoss).toBeLessThan(1);
    expect(levels.tp1Price).toBeCloseTo(1.3);
    expect(levels.tp2Price).toBeCloseTo(1.6);
    expect(levels.riskReward).toBeGreaterThan(0);

    const invalidated = validateEntryPrice(levels, levels.maxAcceptableEntry * 1.05);
    expect(invalidated.entryStatus).toBe('ENTRY_INVALIDATED');
    expect(invalidated.entryValid).toBe(false);
  });
});

describe('evaluateBuyGates', () => {
  it('returns NO TRADE when any mandatory check fails', () => {
    const result = evaluateBuyGates({
      safetyScore: 90,
      signalScore: 90,
      liquidityUsd: 100_000,
      criticalWarning: true,
      dataConflict: false,
      riskReward: 2,
      entryValid: true,
      marketDataCurrent: true,
      independentAgreeing: 4,
      independentRequired: 3,
    });
    expect(result.canBuy).toBe(false);
    expect(result.signalType).toBe(SignalType.NO_TRADE);
  });

  it('allows BUY only when all gates pass', () => {
    const result = evaluateBuyGates({
      safetyScore: 85,
      signalScore: 84,
      liquidityUsd: 80_000,
      criticalWarning: false,
      dataConflict: false,
      riskReward: 2.2,
      entryValid: true,
      marketDataCurrent: true,
      extremeFomo: false,
      highRiskPump: false,
      independentAgreeing: 4,
      independentRequired: 3,
    });
    expect(result.canBuy).toBe(true);
    expect(result.signalType).toBe(SignalType.BUY);
  });
});
