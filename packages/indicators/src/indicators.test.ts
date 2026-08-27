import { describe, expect, it } from 'vitest';
import {
  analyzeCandlestickStructure,
  atr,
  buildIndicatorSnapshot,
  currentCandleWindow,
  ema,
  macd,
  pickChartTimeframes,
  rsi,
  type Candle,
  vwap,
} from './index';

function makeCandles(n: number, start = 100): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const drift = i > n / 2 ? 0.4 : -0.1;
    const open = price;
    const close = price + drift + (i % 3 === 0 ? 0.5 : -0.2);
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    out.push({
      time: i,
      open,
      high,
      low,
      close,
      volume: 1000 + i * 10,
    });
    price = close;
  }
  return out;
}

describe('ema', () => {
  it('computes EMA values after warm-up', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = ema(values, 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(2);
    expect(result[9]).not.toBeNull();
  });
});

describe('rsi', () => {
  it('stays within 0-100', () => {
    const values = Array.from({ length: 40 }, (_, i) => 50 + Math.sin(i / 3) * 5 + i * 0.2);
    const result = rsi(values, 14);
    const last = result[result.length - 1]!;
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThanOrEqual(100);
  });
});

describe('vwap macd atr', () => {
  it('returns finite indicator snapshots', () => {
    const candles = makeCandles(80);
    const vw = vwap(candles);
    const m = macd(candles.map((c) => c.close));
    const a = atr(candles, 14);
    expect(vw[vw.length - 1]).toBeGreaterThan(0);
    expect(m.macd[m.macd.length - 1]).not.toBeNull();
    expect(a[a.length - 1]).toBeGreaterThan(0);

    const snap = buildIndicatorSnapshot(candles, '5m');
    expect(snap.price).not.toBeNull();
    expect(snap.ema9).not.toBeNull();
    expect(snap.atr).not.toBeNull();
  });
});

describe('analyzeCandlestickStructure', () => {
  it('detects a bullish engulfing and scores it higher', () => {
    const candles: Candle[] = [
      ...makeCandles(10, 10),
      { time: 11, open: 12, high: 12.1, low: 11.4, close: 11.5, volume: 800 },
      { time: 12, open: 11.45, high: 12.4, low: 11.4, close: 12.3, volume: 1400 },
    ];
    const result = analyzeCandlestickStructure(candles);
    expect(result.pattern).toBe('BULLISH_ENGULFING');
    expect(result.score).toBeGreaterThan(60);
    expect(result.bullish).toBe(true);
  });
});

describe('chart timeframes', () => {
  it('picks faster charts for a vertical new coin', () => {
    const picked = pickChartTimeframes({
      pairAgeHours: 1,
      priceChangeM5: 12,
      priceChangeH1: 40,
      priceChange24h: 90,
    });
    expect(picked.primary).toBe('1m');
    expect(picked.confirm).toBe('5m');
  });

  it('picks slower charts for a quiet tape', () => {
    const picked = pickChartTimeframes({
      pairAgeHours: 200,
      priceChangeM5: 0.2,
      priceChangeH1: 1,
      priceChange24h: 4,
    });
    expect(picked.primary).toBe('1h');
    expect(picked.confirm).toBe('4h');
  });

  it('honors an explicit user timeframe', () => {
    const picked = pickChartTimeframes({
      requestedPrimary: '15m',
      pairAgeHours: 1,
      priceChangeH1: 50,
    });
    expect(picked.primary).toBe('15m');
    expect(picked.confirm).toBe('1h');
  });

  it('aligns candle close to the timeframe clock', () => {
    const now = Date.parse('2026-08-24T12:03:20Z');
    const win = currentCandleWindow('5m', now);
    expect(win.closeMs).toBe(Date.parse('2026-08-24T12:05:00Z'));
    expect(win.remainingSec).toBe(100);
  });
});
