import { describe, expect, it } from 'vitest';
import {
  applyTestEvent,
  computePaperPerformance,
  createPaperAccount,
  openPaperPosition,
  processPriceUpdate,
} from './index';

describe('paper trading engine', () => {
  it('opens a risk-sized paper position', () => {
    const account = createPaperAccount(1000);
    const { position, error } = openPaperPosition(account, {
      tokenAddress: 'Token1111111111111111111111111111111111111',
      symbol: 'TEST',
      entryPrice: 0.0000102,
      stopLoss: 0.000009,
      tp1Price: 0.0000102 * 1.3,
      tp2Price: 0.0000102 * 1.6,
    });
    expect(error).toBeUndefined();
    expect(position).toBeDefined();
    expect(position!.sizeUsd).toBeGreaterThan(0);
    expect(account.positions).toHaveLength(1);
    expect(account.balance).toBeLessThan(1000);
  });

  it('sells 30% at TP1 and 40% at TP2 then trails remainder', () => {
    let account = createPaperAccount(1000);
    const opened = openPaperPosition(account, {
      tokenAddress: 'Token1111111111111111111111111111111111111',
      symbol: 'TEST',
      entryPrice: 1,
      stopLoss: 0.9,
      tp1Price: 1.3,
      tp2Price: 1.6,
      atr: 0.05,
    });
    expect(opened.position).toBeDefined();
    account = opened.account;

    ({ account } = processPriceUpdate(account, opened.position!.tokenAddress, 1.31));
    const afterTp1 = account.positions[0]!;
    expect(afterTp1.tp1Hit).toBe(true);
    expect(afterTp1.remainingPct).toBeCloseTo(70);

    ({ account } = processPriceUpdate(account, opened.position!.tokenAddress, 1.61));
    const afterTp2 = account.positions[0]!;
    expect(afterTp2.tp2Hit).toBe(true);
    expect(afterTp2.remainingPct).toBeCloseTo(30);
    expect(afterTp2.trailingStop).not.toBeNull();

    const trail = afterTp2.trailingStop!;
    ({ account } = processPriceUpdate(account, opened.position!.tokenAddress, trail * 0.99));
    expect(account.positions).toHaveLength(0);
    expect(account.closedTrades[0]?.exitReason).toBe('TRAILING_STOP');
  });

  it('stops out when SL is hit before TP1', () => {
    let account = createPaperAccount(1000);
    const opened = openPaperPosition(account, {
      tokenAddress: 'Token1111111111111111111111111111111111111',
      symbol: 'TEST',
      entryPrice: 1,
      stopLoss: 0.9,
      tp1Price: 1.3,
      tp2Price: 1.6,
    });
    account = opened.account;
    ({ account } = processPriceUpdate(account, opened.position!.tokenAddress, 0.89));
    expect(account.positions).toHaveLength(0);
    expect(account.closedTrades[0]?.exitReason).toBe('STOP_LOSS');
    expect(account.closedTrades[0]?.realizedPnlUsd).toBeLessThan(0);
  });

  it('supports TEST MODE TP1 event', () => {
    let account = createPaperAccount(1000);
    const opened = openPaperPosition(account, {
      tokenAddress: 'Token1111111111111111111111111111111111111',
      symbol: 'TEST',
      entryPrice: 1,
      stopLoss: 0.9,
      tp1Price: 1.3,
      tp2Price: 1.6,
    });
    account = opened.account;
    const result = applyTestEvent(account, opened.position!.id, 'TP1');
    expect(result.events.some((e) => e.includes('TP1'))).toBe(true);
    expect(result.account.positions[0]?.tp1Hit).toBe(true);
  });

  it('reports performance stats', () => {
    let account = createPaperAccount(1000);
    const opened = openPaperPosition(account, {
      tokenAddress: 'Token1111111111111111111111111111111111111',
      symbol: 'TEST',
      entryPrice: 1,
      stopLoss: 0.9,
      tp1Price: 1.3,
      tp2Price: 1.6,
    });
    account = opened.account;
    ({ account } = applyTestEvent(account, opened.position!.id, 'SL'));
    const perf = computePaperPerformance(account);
    expect(perf.totalTrades).toBe(1);
    expect(perf.losingTrades).toBe(1);
    expect(perf.startingBalance).toBe(1000);
  });
});
