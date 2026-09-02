import { describe, expect, it } from 'vitest';
import { lotsForRisk, pipValueUsd, pipsBetween, getPair, usdDirection } from './pairs';
import { calibrateScore, inEntryZone, dedupeKey, shouldAlertFx } from './analysis';
import { antiOverfit } from './backtest';
import { correlationBlock } from './risk';
import { brokerExecutionChecks } from './execution';
import { isQuoteStale } from './market';
import { highImpactEvents, sessionSnapshot } from './calendar';
import type { FxPosition, FxQuote } from './types';

describe('pip and lot math', () => {
  it('uses 0.0001 pips on EURUSD and 0.01 on USDJPY', () => {
    expect(getPair('EURUSD').pipSize).toBe(0.0001);
    expect(getPair('USDJPY').pipSize).toBe(0.01);
    expect(pipsBetween(getPair('EURUSD'), 1.1000, 1.1010)).toBeCloseTo(10);
    expect(pipsBetween(getPair('USDJPY'), 150.00, 150.20)).toBeCloseTo(20);
  });

  it('values a standard EURUSD pip at $10 per lot', () => {
    expect(pipValueUsd(getPair('EURUSD'), 1.1, 1)).toBeCloseTo(10);
  });

  it('values a USDJPY pip as contract*pip/price', () => {
    expect(pipValueUsd(getPair('USDJPY'), 150, 1)).toBeCloseTo(6.666, 2);
  });

  it('sizes lots from risk, stop distance and pip value', () => {
    const lots = lotsForRisk({ spec: getPair('EURUSD'), price: 1.1, stopPips: 20, balance: 10_000, riskPct: 1 });
    expect(lots).toBeCloseTo(0.5);
  });
});

describe('confidence calibration', () => {
  it('does not treat 90/100 as a 90% win probability', () => {
    const c = calibrateScore(90);
    expect(c.setupQuality).toBe(90);
    expect(c.estimatedHitRateHighPct).toBeLessThan(70);
    expect(c.estimatedHitRateHighPct).not.toBe(90);
    expect(c.warning.toLowerCase()).toContain('not a win probability');
  });
});

describe('entry zone and duplicates', () => {
  it('accepts a zone rather than a single price', () => {
    const zone = { low: 1.099, high: 1.101, mid: 1.1, widthPips: 20 };
    expect(inEntryZone(1.1, zone)).toBe(true);
    expect(inEntryZone(1.1005, zone)).toBe(true);
    expect(inEntryZone(1.102, zone)).toBe(false);
  });

  it('builds a stable duplicate key', () => {
    const zone = { low: 1.1, high: 1.2, mid: 1.15, widthPips: 10 };
    expect(dedupeKey('EURUSD', 'BUY', zone, '2026-08-27')).toBe(dedupeKey('EURUSD', 'BUY', zone, '2026-08-27'));
    expect(dedupeKey('EURUSD', 'BUY', zone, '2026-08-27')).not.toBe(dedupeKey('EURUSD', 'SELL', zone, '2026-08-27'));
  });
});

describe('stale quotes and execution guards', () => {
  const quote = (over: Partial<FxQuote> = {}): FxQuote => ({
    symbol: 'EURUSD',
    bid: 1.1,
    ask: 1.1001,
    mid: 1.10005,
    spreadPips: 1,
    timestamp: new Date().toISOString(),
    ageMs: 0,
    stale: false,
    source: 'test',
    dataQuality: 'LIVE',
    ...over,
  });

  it('rejects stale prices', () => {
    const old = quote({ timestamp: new Date(Date.now() - 5 * 60_000).toISOString(), ageMs: 5 * 60_000, stale: false });
    expect(isQuoteStale(old)).toBe(true);
  });

  it('allows delayed Yahoo FX quotes that are still inside the paper window', () => {
    const yahoo = quote({
      source: 'yahoo-finance',
      timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      ageMs: 10 * 60_000,
      stale: false,
      dataQuality: 'DEGRADED',
    });
    expect(isQuoteStale(yahoo)).toBe(false);
  });

  it('blocks live mode and kill switch, but allows demo fills', () => {
    expect(
      brokerExecutionChecks({ mode: 'PAPER', killSwitch: true, liveBlockedReason: 'no broker', quote: quote() }),
    ).not.toContain('Kill switch is ON');
    expect(
      brokerExecutionChecks({
        mode: 'LIVE',
        killSwitch: true,
        liveBlockedReason: 'No live FX broker adapter is connected. Paper/demo only.',
        quote: quote(),
      }),
    ).toContain('Kill switch is ON');
    expect(
      brokerExecutionChecks({
        mode: 'LIVE',
        killSwitch: false,
        liveBlockedReason: 'No live FX broker adapter is connected. Paper/demo only.',
        quote: quote(),
      }).join(' '),
    ).toMatch(/broker/i);
  });
});

describe('correlation and calendar', () => {
  it('blocks a second highly correlated USD-short', () => {
    const open: FxPosition[] = [
      {
        id: '1',
        signalId: 's',
        symbol: 'EURUSD',
        side: 'BUY',
        mode: 'PAPER',
        openedAt: new Date().toISOString(),
        entry: 1.1,
        lotsOriginal: 0.2,
        lotsOpen: 0.2,
        sl: 1.09,
        tp1: 1.11,
        tp2: 1.12,
        tp1Filled: false,
        tp2Filled: false,
        breakevenOn: false,
        trailingOn: false,
        realizedUsd: 0,
        unrealizedUsd: 0,
        maePips: 0,
        mfePips: 0,
        protect: {
          sl: 1.09,
          tp1: 1.11,
          tp2: 1.12,
          tp1ClosePct: 50,
          tp2ClosePct: 30,
          remainderPct: 20,
          breakevenAfterR: 1,
          trailAtrMult: 1.2,
          maxSpreadPips: 2,
          maxSlippagePips: 1,
        },
        events: [],
        pipeline: { stage: 'PROTECT', steps: [] },
      },
    ];
    expect(correlationBlock('GBPUSD', 'BUY', open)).toMatch(/blocked/i);
    expect(usdDirection(getPair('EURUSD'), 'BUY')).toBe(-1);
  });

  it('includes NFP and 2026 FOMC in the blackout calendar', () => {
    const events = highImpactEvents(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-20T00:00:00Z'));
    expect(events.some((e) => e.name === 'US NFP')).toBe(true);
    expect(events.some((e) => e.name === 'FOMC rate decision')).toBe(true);
    expect(events.some((e) => e.name === 'ECB rate decision' || e.name === 'BoE rate decision')).toBe(true);
  });

  it('flags weekend close', () => {
    const sat = sessionSnapshot(new Date('2026-08-29T12:00:00Z'));
    expect(sat.forexOpen).toBe(false);
  });
});

describe('FX alert vs BUY button', () => {
  it('does not alert on a lean that is not tradeable', () => {
    expect(
      shouldAlertFx({ bias: 'BUY', buyPct: 72, sellPct: 28, tradeable: false }),
    ).toBe(false);
  });

  it('alerts only when tradeable and lean is at least 60%', () => {
    expect(
      shouldAlertFx({ bias: 'BUY', buyPct: 72, sellPct: 28, tradeable: true }),
    ).toBe(true);
    expect(
      shouldAlertFx({ bias: 'BUY', buyPct: 55, sellPct: 45, tradeable: true }),
    ).toBe(false);
  });
});

describe('anti-overfitting', () => {
  it('fails a curve-fit IS/OOS split', () => {
    const is = Array.from({ length: 100 }, () => 1);
    const oos = Array.from({ length: 50 }, () => -0.2);
    const report = antiOverfit(is, oos);
    expect(report.passed).toBe(false);
    expect(report.reasons.join(' ')).toMatch(/out-of-sample/i);
  });
});
