import { describe, expect, it } from 'vitest';
import {
  applyPercent,
  buildQuoteBreakdown,
  canSubmitStatus,
  computeAvgEntry,
  isTerminalStatus,
  reducePosition,
  unrealizedPnl,
  usdToSolLamports,
  validateAmountUsd,
  validateMint,
  validateWallet,
} from './swap.logic';

describe('swap validation', () => {
  it('rejects invalid mints, wallets, and dust amounts', () => {
    expect(validateMint('nope')).toBe('INVALID_ADDRESS');
    expect(validateWallet(null)).toBe('WALLET_DISCONNECTED');
    expect(validateWallet('zzz')).toBe('INVALID_WALLET');
    expect(validateAmountUsd(0)).toBe('INVALID_AMOUNT');
    expect(validateAmountUsd(0.1)).toBe('INVALID_AMOUNT');
    expect(validateMint('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263')).toBeNull();
  });

  it('never treats unconfirmed statuses as success', () => {
    expect(isTerminalStatus('CONFIRMED')).toBe(true);
    expect(isTerminalStatus('PENDING')).toBe(false);
    expect(isTerminalStatus('SUBMITTED')).toBe(false);
    expect(canSubmitStatus('AWAITING_WALLET')).toBe(true);
    expect(canSubmitStatus('CONFIRMED')).toBe(false);
  });
});

describe('quote breakdown', () => {
  it('keeps platform fee separate from network fee', () => {
    const q = buildQuoteBreakdown({
      amountUsd: 100,
      platformFeeBps: 50,
      networkFeeUsd: 0.04,
      estimatedReceived: 1234,
      minimumReceived: 1200,
      priceImpactPct: 0.8,
      currentPrice: 0.08,
    });
    expect(q.platformFeeUsd).toBe(0.5);
    expect(q.networkFeeUsd).toBe(0.04);
    expect(q.totalUsd).toBe(100.04);
    expect(q.platformFeeUsd).not.toBe(q.networkFeeUsd);
  });

  it('applies percent buttons against wallet balance', () => {
    expect(applyPercent(2, 50)).toBe(1);
    expect(applyPercent(2, 100)).toBe(2);
    expect(applyPercent(2, 10)).toBeCloseTo(0.2);
  });
});

describe('portfolio math', () => {
  it('updates average entry and PnL after buy then sell', () => {
    const afterBuy = computeAvgEntry(0, 0, 1000, 0.001);
    expect(afterBuy.avgEntry).toBe(0.001);
    const add = computeAvgEntry(1000, 0.001, 1000, 0.003);
    expect(add.qty).toBe(2000);
    expect(add.avgEntry).toBe(0.002);
    const sold = reducePosition(2000, 0.002, 1000, 0.004);
    expect(sold.qty).toBe(1000);
    expect(sold.realizedPnlUsd).toBeCloseTo(2);
    const u = unrealizedPnl(1000, 0.002, 0.003);
    expect(u.pnlUsd).toBeCloseTo(1);
    expect(u.roiPct).toBeCloseTo(50);
  });

  it('converts USD size to SOL lamports', () => {
    expect(usdToSolLamports(150, 150).toString()).toBe('1000000000');
  });
});
