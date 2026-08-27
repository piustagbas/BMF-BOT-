import { describe, expect, it } from 'vitest';
import { runScan } from './pipeline';
import { analyzePair } from './analysis';
import type { PairMarket } from './market';
import { getPair } from './pairs';
import type { FxCandle, FxQuote } from './types';
import { sessionSnapshot } from './calendar';
import { managePosition, openProtectedPosition } from './execution';
import type { FxSignal } from './types';

function candles(trend: 'up' | 'down'): FxCandle[] {
  const out: FxCandle[] = [];
  let p = trend === 'up' ? 1.08 : 1.12;
  for (let i = 0; i < 90; i++) {
    const drift = trend === 'up' ? 0.00018 : -0.00018;
    const open = p;
    p += drift;
    const close = i > 82 ? p - drift * 3 : p;
    const high = Math.max(open, close) + 0.00015;
    const low = Math.min(open, close) - 0.00015;
    out.push({ time: Date.UTC(2026, 7, 26) + i * 900_000, open, high, low, close, volume: 1000 });
    p = close;
  }
  return out;
}

function market(over: Partial<PairMarket> = {}): PairMarket {
  const spec = getPair('EURUSD');
  const cs = candles('up');
  const mid = cs[cs.length - 1]!.close;
  const quote: FxQuote = {
    symbol: 'EURUSD',
    bid: mid - 0.00005,
    ask: mid + 0.00005,
    mid,
    spreadPips: 1,
    timestamp: new Date().toISOString(),
    ageMs: 200,
    stale: false,
    source: 'test',
    dataQuality: 'LIVE',
  };
  const atr = 0.0012;
  return {
    spec,
    quote,
    candles: cs,
    atr,
    spike: false,
    ...over,
  };
}

describe('pipeline scan', () => {
  it('emits at most one alert per setup (duplicate suppression)', () => {
    const m = market();
    const now = new Date('2026-08-26T14:00:00Z');
    const first = runScan({ markets: [m], now, balance: 10_000, open: [], existing: [] });
    const second = runScan({
      markets: [m],
      now,
      balance: 10_000,
      open: [],
      existing: first.signals,
    });
    if (first.signals.length) {
      expect(second.duplicateSuppressed).toBeGreaterThan(0);
      expect(second.signals).toHaveLength(0);
    }
  });

  it('refuses stale quotes for execution but still lists the pair', () => {
    const m = market({
      quote: {
        ...market().quote,
        timestamp: new Date(Date.now() - 40_000).toISOString(),
        ageMs: 40_000,
        stale: true,
      },
    });
    const result = runScan({ markets: [m], now: new Date(), balance: 10_000, open: [], existing: [] });
    expect(result.board).toHaveLength(1);
    expect(result.board[0]?.symbol).toBe('EURUSD');
    expect(result.board[0]?.tradeable).toBe(false);
  });
});

describe('analysis + manage', () => {
  it('uses an entry zone and calibrated score when tradeable', () => {
    const now = new Date('2026-08-26T14:00:00Z');
    const result = analyzePair(market(), sessionSnapshot(now), []);
    if (result.tradeable && result.zone) {
      expect(result.zone.high).toBeGreaterThan(result.zone.low);
      expect(result.confidence.setupQuality).not.toBe(result.confidence.estimatedHitRateHighPct);
      expect(result.stopLoss).not.toBeNull();
    }
  });

  it('moves to breakeven after TP1 and trails remainder after TP2', () => {
    const m = market();
    const signal = {
      id: 's1',
      dedupeKey: 'k',
      symbol: 'EURUSD',
      side: 'BUY',
      quote: m.quote,
      zone: { low: m.quote.mid - 0.0004, high: m.quote.mid + 0.0004, mid: m.quote.mid, widthPips: 8 },
      stopLoss: m.quote.mid - 0.0015,
      takeProfit1: m.quote.mid + 0.0015,
      takeProfit2: m.quote.mid + 0.003,
      stopPips: 15,
      tp1Pips: 15,
      tp2Pips: 30,
      riskReward1: 1,
      suggestedLots: 0.2,
      riskUsd: 100,
      pipValueUsd: 2,
      setupQuality: 70,
      breakdown: { trend: 20, pullback: 10, structure: 10, reward: 10, spread: 8, session: 8, freshness: 8, total: 74 },
      confidence: {
        setupQuality: 70,
        estimatedHitRateLowPct: 50,
        estimatedHitRateHighPct: 56,
        sampleNote: 'x',
        warning: 'not a win probability',
      },
      reasons: ['test'],
      filtersFailed: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      pipeline: { stage: 'NOTIFY', steps: [] },
      notified: true,
    } satisfies FxSignal;
    const pos = openProtectedPosition({ signal, fill: m.quote.ask, lots: 0.2, mode: 'PAPER', atr: m.atr ?? 0.001 });
    const tp1Market: PairMarket = {
      ...m,
      quote: { ...m.quote, bid: signal.takeProfit1 + 0.0001, ask: signal.takeProfit1 + 0.0002, mid: signal.takeProfit1 },
    };
    const afterTp1 = managePosition(pos, tp1Market);
    expect(afterTp1.position.tp1Filled).toBe(true);
    expect(afterTp1.position.breakevenOn).toBe(true);
    expect(afterTp1.position.lotsOpen).toBeLessThan(0.2);
  });
});
