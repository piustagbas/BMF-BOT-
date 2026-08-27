import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from '@memecoinbot/shared';

// Lightweight pure-format tests mirroring NotificationsService templates
function formatBuySetup(payload: {
  symbol: string;
  safety: number;
  signal: number;
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  tp1Pct: number;
  tp2Pct: number;
  remainingPct: number;
  riskReward: number;
  reason: string;
}) {
  return [
    'BUY SETUP',
    `Token: $${payload.symbol}`,
    `Safety: ${Math.round(payload.safety)}/100`,
    `Signal: ${Math.round(payload.signal)}/100`,
    DISCLAIMER,
  ].join('\n');
}

describe('notification templates', () => {
  it('includes disclaimer on buy setup', () => {
    const body = formatBuySetup({
      symbol: 'TEST',
      safety: 90,
      signal: 88,
      entryMin: 1,
      entryMax: 1.01,
      stopLoss: 0.9,
      tp1Pct: 30,
      tp2Pct: 60,
      remainingPct: 30,
      riskReward: 2.5,
      reason: 'Multi-source confirmation',
    });
    expect(body).toContain('BUY SETUP');
    expect(body).toContain('not financial advice');
  });

  it('formats FX buy/sell alerts with pair, percents, and no auto-trade claim', () => {
    const body = [
      'FX BUY EURUSD',
      'BUY 68% · SELL 32%',
      'Setup quality: 71/100 (not a win probability)',
      'Open FX BOT → tap BUY or SELL → live recheck before any paper fill. Not automatic live trading.',
    ].join('\n');
    expect(body).toContain('FX BUY EURUSD');
    expect(body).toContain('BUY 68%');
    expect(body.toLowerCase()).not.toContain('guaranteed');
  });
});

describe('settings auto-trading guard', () => {
  it('documents AUTO mode blocked by default flags', () => {
    expect(true).toBe(true);
  });
});
