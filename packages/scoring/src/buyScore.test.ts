import { describe, expect, it } from 'vitest';
import { SignalType } from '@memecoinbot/shared';
import { analyzeCandlestickStructure } from '@memecoinbot/indicators';
import {
  calculateTradeLevels,
  computeBuyScore,
  evaluateBuyGates,
  evaluateMasterStrategy,
  scoreFomoPump,
  scoreSmartMoneyFromConsensus,
  scoreSmartMoneyFromHoldings,
  scoreSocialSentiment,
} from './index';

describe('computeBuyScore', () => {
  it('blends independent components and ignores missing smart money', () => {
    const withSmart = computeBuyScore({
      components: {
        safety: 90,
        technical: 80,
        momentum: 78,
        candlestick: 72,
        smartMoney: 70,
        social: 68,
        fomoQuality: 80,
      },
    });
    const withoutSmart = computeBuyScore({
      components: {
        safety: 90,
        technical: 80,
        momentum: 78,
        candlestick: 72,
        smartMoney: null,
        social: 68,
        fomoQuality: 80,
      },
    });
    expect(withSmart.usedSmartMoney).toBe(true);
    expect(withoutSmart.usedSmartMoney).toBe(false);
    expect(withSmart.buyScore).toBeGreaterThan(70);
    expect(withoutSmart.buyScore).toBeGreaterThan(70);
    expect(withoutSmart.weights.smartMoney).toBe(0);
  });
});

describe('FOMO / pump and social', () => {
  it('flags extreme FOMO on a parabolic print', () => {
    const fomo = scoreFomoPump({
      priceChangeM5: 22,
      priceChangeH1: 48,
      priceChange24h: 160,
      pairAgeHours: 1.2,
      rsi: 86,
      volumeExpansion: true,
      volume24h: 2_000_000,
      liquidityUsd: 40_000,
    });
    expect(fomo.extremeFomo).toBe(true);
    expect(fomo.highRiskPump).toBe(true);
  });

  it('scores constructive flow as social sentiment', () => {
    const social = scoreSocialSentiment({
      buys24h: 800,
      sells24h: 420,
      volume24h: 180_000,
      liquidityUsd: 90_000,
      marketCap: 600_000,
      priceChangeH1: 8,
      priceChange24h: 18,
    });
    expect(social.score).toBeGreaterThan(60);
  });
});

describe('scoreSmartMoneyFromConsensus', () => {
  it('treats consensus as an input score, not a guaranteed buy', () => {
    const scored = scoreSmartMoneyFromConsensus({
      available: true,
      independent: 5,
      tierA: 3,
      tierB: 2,
      strength: 91,
      reason: '3 Tier A wallets accumulated independently',
    });
    expect(scored.score).toBe(91);
    expect(scored.notes.join(' ')).toMatch(/not.*automatic BUY|never copy-trade/i);
  });
});

describe('smart money missing vs zero holders', () => {
  it('marks missing data as unavailable (Why Not Buy shows no data, not a skip)', () => {
    const none = scoreSmartMoneyFromHoldings({ walletsChecked: 0, unavailable: true });
    expect(none.available).toBe(false);
    expect(none.score).toBeNull();
    expect(none.notes.join(' ')).toMatch(/warming up|no smart money/i);
  });

  it('scores zero holdings when wallets were actually checked', () => {
    const empty = scoreSmartMoneyFromHoldings({ walletsChecked: 8, holders: 0 });
    expect(empty.available).toBe(true);
    expect(empty.score).toBe(28);
    expect(empty.notes.join(' ')).toMatch(/0\/8 tracked wallets hold/);
  });
});

describe('evaluateBuyGates master rules', () => {
  it('blocks when independent signals do not agree', () => {
    const result = evaluateBuyGates({
      safetyScore: 90,
      signalScore: 88,
      liquidityUsd: 80_000,
      criticalWarning: false,
      riskReward: 2.4,
      entryValid: true,
      independentAgreeing: 1,
      independentRequired: 3,
    });
    expect(result.canBuy).toBe(false);
    expect(result.failedChecks.some((c) => c.includes('Independent'))).toBe(true);
  });

  it('blocks extreme FOMO even when scores look strong', () => {
    const result = evaluateBuyGates({
      safetyScore: 90,
      signalScore: 88,
      liquidityUsd: 80_000,
      criticalWarning: false,
      riskReward: 2.4,
      entryValid: true,
      extremeFomo: true,
      independentAgreeing: 4,
      independentRequired: 3,
    });
    expect(result.canBuy).toBe(false);
    expect(result.failedChecks.some((c) => /FOMO/i.test(c))).toBe(true);
  });

  it('blocks R:R below 1:2', () => {
    const result = evaluateBuyGates({
      safetyScore: 90,
      signalScore: 88,
      liquidityUsd: 80_000,
      criticalWarning: false,
      riskReward: 1.4,
      minRiskReward: 2,
      entryValid: true,
      independentAgreeing: 4,
      independentRequired: 3,
    });
    expect(result.canBuy).toBe(false);
    expect(result.failedChecks.some((c) => c.includes('R:R'))).toBe(true);
  });
});

describe('evaluateMasterStrategy', () => {
  it('returns Why Not Buy items when a hard gate fails', () => {
    const levels = calculateTradeLevels({
      currentPrice: 1,
      atr: 0.04,
      support: 0.97,
      tp1Pct: 30,
      tp2Pct: 60,
    });
    const result = evaluateMasterStrategy({
      safetyScore: 88,
      technicalScore: 80,
      momentumScore: 78,
      candlestick: analyzeCandlestickStructure([
        { time: 1, open: 1, high: 1.02, low: 0.99, close: 1.01, volume: 10 },
        { time: 2, open: 1.01, high: 1.05, low: 1.0, close: 1.04, volume: 12 },
      ]),
      smartMoney: scoreSmartMoneyFromHoldings({ walletsChecked: 2, holders: 1 }),
      social: scoreSocialSentiment({
        buys24h: 200,
        sells24h: 120,
        volume24h: 80_000,
        liquidityUsd: 90_000,
        marketCap: 400_000,
        priceChangeH1: 6,
        priceChange24h: 12,
      }),
      fomo: scoreFomoPump({
        priceChangeM5: 20,
        priceChangeH1: 40,
        priceChange24h: 140,
        pairAgeHours: 1,
        rsi: 84,
        volumeExpansion: true,
        volume24h: 900_000,
        liquidityUsd: 40_000,
      }),
      levels,
      liquidityUsd: 90_000,
      criticalWarning: false,
    });
    expect(result.canBuy).toBe(false);
    expect(result.whyNotBuy.title).toBe('Why Not Buy');
    expect(result.whyNotBuy.items.some((i) => i.key === 'fomo' && !i.passed)).toBe(
      true,
    );
    expect(result.signalType).not.toBe(SignalType.BUY);
  });

  it('can buy when independent signals agree and gates pass', () => {
    const levels = calculateTradeLevels({
      currentPrice: 1,
      atr: 0.02,
      support: 0.93,
      tp1Pct: 30,
      tp2Pct: 60,
    });
    const result = evaluateMasterStrategy({
      safetyScore: 88,
      technicalScore: 82,
      momentumScore: 80,
      candlestick: { ...analyzeCandlestickStructure([]), score: 75, bullish: true },
      smartMoney: scoreSmartMoneyFromHoldings({ walletsChecked: 3, holders: 2 }),
      social: { score: 70, available: true, notes: ['Buy pressure'] },
      fomo: {
        fomoScore: 10,
        pumpScore: 8,
        extremeFomo: false,
        highRiskPump: false,
        notes: ['No extreme FOMO / pump flags'],
      },
      levels: { ...levels, entryValid: true, riskReward: Math.max(levels.riskReward, 2.1) },
      liquidityUsd: 120_000,
      criticalWarning: false,
    });
    expect(result.agreeing).toBeGreaterThanOrEqual(3);
    expect(result.canBuy).toBe(true);
    expect(result.whyNotBuy.title).toBe('Why This Passed');
    expect(result.signalType).toBe(SignalType.BUY);
  });
});
