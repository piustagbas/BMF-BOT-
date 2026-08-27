import { describe, expect, it } from 'vitest';
import { ohlcvCacheKey, sliceCandles } from './ohlcv';
import type { Candle } from '@memecoinbot/indicators';

function candle(time: number): Candle {
  return { time, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 10 };
}

describe('ohlcv cache helpers', () => {
  it('shares one cache key per pool and timeframe (not request limit)', () => {
    expect(ohlcvCacheKey('pool1', '5m')).toBe('pool1:5m');
    expect(ohlcvCacheKey('pool1', '5m')).toBe(ohlcvCacheKey('pool1', '5m'));
    expect(ohlcvCacheKey('pool1', '15m')).not.toBe(ohlcvCacheKey('pool1', '5m'));
  });

  it('returns the newest candles when slicing', () => {
    const all = [candle(1), candle(2), candle(3), candle(4)];
    expect(sliceCandles(all, 2).map((c) => c.time)).toEqual([3, 4]);
    expect(sliceCandles(all, 10)).toEqual(all);
  });
});
