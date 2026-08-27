import { describe, expect, it } from 'vitest';
import {
  classifyHolderRisk,
  classifyWhaleActivity,
  computeSafetyScore,
} from './index';
import { HolderRiskLevel, WhaleActivity } from '@memecoinbot/shared';

describe('classifyHolderRisk', () => {
  it('classifies concentration bands', () => {
    expect(classifyHolderRisk(25, 40)).toBe(HolderRiskLevel.LOW);
    expect(classifyHolderRisk(45, 62)).toBe(HolderRiskLevel.MEDIUM);
    expect(classifyHolderRisk(60, 70)).toBe(HolderRiskLevel.HIGH);
    expect(classifyHolderRisk(75, 90)).toBe(HolderRiskLevel.CRITICAL);
  });
});

describe('classifyWhaleActivity', () => {
  it('detects accumulation and distribution', () => {
    expect(
      classifyWhaleActivity({ buys24h: 80, sells24h: 20, top10Pct: 30 }),
    ).toBe(WhaleActivity.ACCUMULATION);
    expect(
      classifyWhaleActivity({ buys24h: 20, sells24h: 80, top10Pct: 30 }),
    ).toBe(WhaleActivity.DISTRIBUTION);
  });
});

describe('computeSafetyScore', () => {
  it('returns high score for strong token profile', () => {
    const result = computeSafetyScore({
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      mutableMetadata: false,
      liquidityUsd: 150_000,
      top10Pct: 28,
      top20Pct: 42,
      holderCount: 5000,
      buys24h: 400,
      sells24h: 350,
      volume24h: 200_000,
      pairAgeHours: 200,
      creatorBalancePct: 0.5,
      dangerRiskCount: 0,
      warnRiskCount: 0,
    });
    expect(result.criticalWarning).toBe(false);
    expect(result.decision).toBe('POTENTIAL_SETUP');
    expect(result.safetyScore).toBeGreaterThanOrEqual(80);
  });

  it('forces NO TRADE when mint authority is active', () => {
    const result = computeSafetyScore({
      mintAuthorityRevoked: false,
      freezeAuthorityRevoked: true,
      liquidityUsd: 200_000,
      top10Pct: 20,
      top20Pct: 35,
      holderCount: 1000,
      buys24h: 100,
      sells24h: 80,
      volume24h: 50_000,
      pairAgeHours: 48,
      creatorBalancePct: 1,
    });
    expect(result.criticalWarning).toBe(true);
    expect(result.decision).toBe('NO_TRADE');
    expect(result.criticalReasons[0]).toMatch(/Mint authority/i);
  });

  it('forces NO TRADE on critical holder concentration', () => {
    const result = computeSafetyScore({
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      liquidityUsd: 80_000,
      top10Pct: 80,
      top20Pct: 92,
      holderCount: 40,
      buys24h: 50,
      sells24h: 40,
      volume24h: 20_000,
      pairAgeHours: 12,
    });
    expect(result.decision).toBe('NO_TRADE');
    expect(result.holderRisk).toBe(HolderRiskLevel.CRITICAL);
  });

  it('respects custom weights', () => {
    const result = computeSafetyScore({
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      liquidityUsd: 5_000,
      top10Pct: 30,
      top20Pct: 45,
      holderCount: 200,
      buys24h: 20,
      sells24h: 20,
      volume24h: 5_000,
      pairAgeHours: 10,
      weights: {
        liquidity: 0.8,
        tokenSecurity: 0.05,
        holderDistribution: 0.05,
        tradingActivity: 0.025,
        volumeQuality: 0.025,
        developerActivity: 0.025,
        tokenHistory: 0.025,
      },
    });
    expect(result.weights.liquidity).toBeGreaterThan(0.7);
    expect(result.safetyScore).toBeLessThan(70);
  });

  it('scores lower when market context is missing (liquidity/volume/age)', () => {
    const base = {
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      mutableMetadata: false,
      top10Pct: 28,
      top20Pct: 42,
      holderCount: 5000,
      creatorBalancePct: 0.5,
      dangerRiskCount: 0,
      warnRiskCount: 0,
    };
    const withMarket = computeSafetyScore({
      ...base,
      liquidityUsd: 150_000,
      buys24h: 400,
      sells24h: 350,
      volume24h: 200_000,
      pairAgeHours: 200,
    });
    const withoutMarket = computeSafetyScore({
      ...base,
      liquidityUsd: null,
      buys24h: null,
      sells24h: null,
      volume24h: null,
      pairAgeHours: null,
    });
    expect(withMarket.safetyScore).toBeGreaterThan(withoutMarket.safetyScore);
    expect(withMarket.safetyScore - withoutMarket.safetyScore).toBeGreaterThan(8);
  });
});
