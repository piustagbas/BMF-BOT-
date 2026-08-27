import { describe, expect, it } from 'vitest';
import { StrategyId } from '@memecoinbot/shared';
import type { IndicatorSnapshot } from '@memecoinbot/indicators';
import { analyzeMomentum, evaluateStrategies } from './index';

function snap(partial: Partial<IndicatorSnapshot>): IndicatorSnapshot {
  return {
    timeframe: '5m',
    price: 1,
    ema9: 1.02,
    ema21: 1.01,
    ema50: 1.0,
    vwap: 0.99,
    rsi: 58,
    macd: 0.01,
    macdSignal: 0.005,
    macdHistogram: 0.005,
    atr: 0.02,
    volumeMa: 100,
    volume: 200,
    support: 0.95,
    resistance: 1.05,
    trend: 'BULLISH',
    higherHighs: true,
    higherLows: true,
    lowerHighs: false,
    lowerLows: false,
    breakout: true,
    breakoutRetest: true,
    bullishEmaStack: true,
    aboveVwap: true,
    volumeExpansion: true,
    ...partial,
  };
}

describe('evaluateStrategies', () => {
  it('triggers multiple strategies on strong setup', () => {
    const results = evaluateStrategies({
      primary: snap({}),
      confirmation: snap({ timeframe: '15m', breakout: false }),
      momentumScore: 80,
      volumeScore: 70,
    });
    expect(results.some((r) => r.triggered)).toBe(true);
    expect(results.find((r) => r.strategyId === StrategyId.EMA_TREND_CONTINUATION)?.triggered).toBe(
      true,
    );
  });

  it('does not treat volume alone as buy', () => {
    const results = evaluateStrategies({
      primary: snap({
        volumeExpansion: true,
        breakout: false,
        bullishEmaStack: false,
        aboveVwap: false,
        trend: 'RANGE',
      }),
      momentumScore: 40,
      volumeScore: 90,
    });
    const vol = results.find((r) => r.strategyId === StrategyId.VOLUME_EXPANSION);
    expect(vol?.triggered).toBe(false);
  });
});

describe('analyzeMomentum', () => {
  it('flags exhaustion at high RSI', () => {
    const strong = analyzeMomentum(snap({ rsi: 58, volumeExpansion: true }));
    const m = analyzeMomentum(snap({ rsi: 85, volumeExpansion: true }));
    expect(m.exhaustion).toBe(true);
    expect(m.score).toBeLessThan(strong.score);
  });
});
