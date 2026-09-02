import { describe, expect, it } from 'vitest';
import {
  completionKindForPnl,
  eventTypeForKind,
  formatTelegramTrade,
  formatTradeEvent,
} from './trade-events';

describe('trade notification copy', () => {
  it('formats a confirmed buy without calling it successful before confirmation kind', () => {
    const msg = formatTradeEvent({
      kind: 'BUY_CONFIRMED',
      eventId: 'e1',
      symbol: 'PEPE',
      amountUsd: 100,
      tokenQuantity: 250000,
      entryPrice: 0.0004,
    });
    expect(msg.title).toBe('Buy Confirmed');
    expect(msg.body).toContain('$PEPE');
    expect(msg.body).toContain('Amount: $100.00');
    expect(msg.body).toContain('Transaction: Confirmed');
  });

  it('formats sell pnl and pending vs failed', () => {
    const sell = formatTradeEvent({
      kind: 'SELL_CONFIRMED',
      eventId: 'e2',
      symbol: 'PEPE',
      tokenQuantity: 100,
      receivedUsd: 137.2,
      pnlUsd: 37.2,
      roiPct: 37.2,
    });
    expect(sell.body).toContain('PnL: +$37.20');
    expect(sell.body).toContain('ROI: +37.2%');

    const pending = formatTradeEvent({
      kind: 'TX_PENDING',
      eventId: 'e3',
      symbol: 'PEPE',
    });
    expect(pending.title).toBe('Trade Pending');
    expect(pending.body.toLowerCase()).not.toContain('confirmed');

    const failed = formatTradeEvent({
      kind: 'TX_FAILED',
      eventId: 'e4',
      symbol: 'PEPE',
      reason: 'Not enough balance for this trade.',
    });
    expect(failed.title).toBe('Trade Failed');
    expect(failed.body).toContain('Not enough balance');
    expect(failed.body).not.toMatch(/ECONNREFUSED|stack/i);
  });

  it('formats TP/SL alerts as sell-now prompts, not executed orders', () => {
    const tp = formatTradeEvent({
      kind: 'TAKE_PROFIT',
      eventId: 'e5',
      symbol: 'PEPE',
      entryPrice: 0.001,
      currentPrice: 0.0015,
      takeProfitPct: 50,
    });
    expect(tp.title).toBe('Take Profit Triggered');
    expect(tp.body).toContain('[SELL NOW]');
    expect(tp.body.toLowerCase()).not.toContain('order confirmed');

    const submitted = formatTradeEvent({
      kind: 'SELL_SUBMITTED',
      eventId: 'e6',
      symbol: 'PEPE',
    });
    expect(submitted.title).toBe('Sell order submitted');
    expect(submitted.body).toContain('not yet confirmed');
  });

  it('telegram templates match the product copy', () => {
    const buy = formatTelegramTrade({
      kind: 'BUY_CONFIRMED',
      eventId: 't1',
      symbol: 'TOKEN',
      amountUsd: 100,
      entryPrice: 0.00042,
    });
    expect(buy.title).toBe('🟢 BUY CONFIRMED');
    expect(buy.body).toContain('Transaction confirmed.');
    expect(eventTypeForKind('BUY_CONFIRMED')).toBe('BUY');
    expect(eventTypeForKind('TX_FAILED')).toBe('TX_FAILED');
  });

  it('formats final manual trade results for Telegram', () => {
    const success = formatTelegramTrade({
      kind: 'TRADE_SUCCEEDED',
      eventId: 'manual-success',
      symbol: 'PEPE',
      side: 'SELL',
      assetClass: 'MEMECOIN',
      executionMode: 'LIVE',
      receivedUsd: 137.2,
      pnlUsd: 37.2,
      roiPct: 37.2,
    });
    expect(success.title).toBe('✅ SELL SUCCESSFUL');
    expect(success.body).toContain('Received: $137.20');
    expect(success.body).toContain('PnL: +$37.20');

    const failure = formatTelegramTrade({
      kind: 'TRADE_FAILED',
      eventId: 'manual-failure',
      symbol: 'PEPE',
      side: 'BUY',
      assetClass: 'MEMECOIN',
      executionMode: 'LIVE',
      reason: 'Not enough SOL for gas',
    });
    expect(failure.title).toBe('❌ BUY FAILED');
    expect(failure.body).toContain('Not enough SOL for gas');
  });

  it('formats user-visible success and failure results for meme and forex trades', () => {
    const meme = formatTradeEvent({
      kind: 'TRADE_SUCCEEDED',
      eventId: 'result-1',
      symbol: 'PEPE',
      side: 'BUY',
      assetClass: 'MEMECOIN',
      executionMode: 'PAPER',
      entryPrice: 0.01,
    });
    expect(meme.title).toContain('successful');
    expect(meme.body).toContain('$PEPE');
    expect(meme.body.toLowerCase()).toContain('paper');

    const fx = formatTradeEvent({
      kind: 'TRADE_FAILED',
      eventId: 'result-2',
      symbol: 'EURUSD',
      side: 'SELL',
      assetClass: 'FOREX',
      reason: 'Spread too wide',
    });
    expect(fx.title).toContain('failed');
    expect(fx.body).toContain('EURUSD');
    expect(fx.body).toContain('Spread too wide');
    expect(fx.body).not.toContain('$EURUSD');
  });

  it('uses Success and Failure for completed profit and loss results', () => {
    const profit = formatTradeEvent({
      kind: 'TRADE_PROFIT',
      eventId: 'profit-1',
      symbol: 'PEPE',
      side: 'SELL',
      pnlUsd: 12.5,
      roiPct: 25,
    });
    expect(profit.title).toBe('Success');
    expect(profit.body).toContain('Trade finished with profit.');
    expect(profit.body).toContain('Profit: +$12.50');

    const loss = formatTelegramTrade({
      kind: 'TRADE_LOSS',
      eventId: 'loss-1',
      symbol: 'PEPE',
      side: 'SELL',
      pnlUsd: -8,
    });
    expect(loss.title).toBe('Failure');
    expect(loss.body).toContain('Trade finished with loss.');
    expect(loss.body).toContain('Loss: -$8.00');
  });

  it('classifies finite completed PnL values', () => {
    expect(completionKindForPnl(1)).toBe('TRADE_PROFIT');
    expect(completionKindForPnl(0)).toBe('TRADE_LOSS');
    expect(completionKindForPnl(-1)).toBe('TRADE_LOSS');
    expect(completionKindForPnl(undefined)).toBeNull();
  });
});
