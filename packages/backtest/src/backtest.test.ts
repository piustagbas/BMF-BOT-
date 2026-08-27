import { describe, expect, it } from 'vitest';
import type { Candle } from '@memecoinbot/indicators';
import { runBacktest, trackSignalOutcome } from './index';

function makeTrendCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let price = 1;
  for (let i = 0; i < n; i++) {
    const drift = i > 40 ? 0.01 : 0.002;
    const open = price;
    const close = price * (1 + drift + (i % 7 === 0 ? 0.015 : 0));
    const high = Math.max(open, close) * 1.01;
    const low = Math.min(open, close) * 0.992;
    out.push({
      time: 1_700_000_000 + i * 300,
      open,
      high,
      low,
      close,
      volume: 1000 + i * 20 + (i % 7 === 0 ? 2000 : 0),
    });
    price = close;
  }
  return out;
}

describe('trackSignalOutcome', () => {
  it('detects TP1 and records MFE/MAE', () => {
    const candles: Candle[] = [
      { time: 100, open: 1, high: 1.01, low: 0.99, close: 1, volume: 10 },
      { time: 200, open: 1, high: 1.35, low: 0.98, close: 1.3, volume: 10 },
      { time: 300, open: 1.3, high: 1.7, low: 1.25, close: 1.6, volume: 10 },
    ];
    const outcome = trackSignalOutcome({
      entryPrice: 1,
      stopLoss: 0.9,
      tp1Price: 1.3,
      tp2Price: 1.6,
      signalTime: 100,
      candles,
    });
    expect(outcome.tp1Hit).toBe(true);
    expect(outcome.tp2Hit).toBe(true);
    expect(outcome.slHit).toBe(false);
    expect(outcome.mfePct).toBeGreaterThan(50);
    expect(outcome.maePct).toBeLessThanOrEqual(0);
  });

  it('prefers SL when stop is hit first', () => {
    const candles: Candle[] = [
      { time: 100, open: 1, high: 1.02, low: 0.88, close: 0.9, volume: 10 },
    ];
    const outcome = trackSignalOutcome({
      entryPrice: 1,
      stopLoss: 0.9,
      tp1Price: 1.3,
      tp2Price: 1.6,
      signalTime: 100,
      candles,
    });
    expect(outcome.firstExit).toBe('SL');
    expect(outcome.slHit).toBe(true);
  });
});

describe('runBacktest', () => {
  it('runs in-sample and out-of-sample segments', () => {
    const candles = makeTrendCandles(160);
    const result = runBacktest(candles, {
      startingBalance: 1000,
      timeframe: '5m',
      warmupBars: 60,
      outOfSamplePct: 0.3,
      minBarsBetweenEntries: 3,
    });
    expect(result.inSample.bars).toBeGreaterThan(50);
    expect(result.outOfSample.bars).toBeGreaterThan(20);
    expect(result.full.bars).toBe(160);
    expect(result.warning).toMatch(/overfit/i);
    expect(result.full.performance.startingBalance).toBe(1000);
  });
});
