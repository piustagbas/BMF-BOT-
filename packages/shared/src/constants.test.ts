import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK,
  DEFAULT_TRADING_FLAGS,
  MEME_COIN_SCORE_WEIGHTS,
  SMART_MONEY_SCORE_WEIGHTS,
  TradingMode,
  dexScreenerSolanaUrl,
  formatPairAgeHours,
  isNewCoinAge,
} from './constants';

describe('defaults', () => {
  it('keeps auto trading off and kill switch on', () => {
    expect(DEFAULT_TRADING_FLAGS.autoTradingEnabled).toBe(false);
    expect(DEFAULT_TRADING_FLAGS.killSwitch).toBe(true);
    expect(DEFAULT_TRADING_FLAGS.tradingMode).toBe(TradingMode.SIGNAL_ONLY);
  });

  it('uses paper-first risk defaults', () => {
    expect(DEFAULT_RISK.paperBalance).toBe(1000);
    expect(DEFAULT_RISK.safetyMin).toBe(80);
    expect(DEFAULT_RISK.signalMin).toBe(80);
    expect(dexScreenerSolanaUrl('Mint111', 'Pair222')).toBe(
      'https://dexscreener.com/solana/Pair222',
    );
    expect(dexScreenerSolanaUrl('Mint111')).toBe(
      'https://dexscreener.com/solana/Mint111',
    );
    expect(DEFAULT_RISK.tp1Pct).toBe(30);
    expect(DEFAULT_RISK.tp2Pct).toBe(60);
    expect(DEFAULT_RISK.minRiskReward).toBe(2);
  });

  it('keeps new-coin window at 1–10 days', () => {
    expect(isNewCoinAge(0)).toBe(false);
    expect(isNewCoinAge(12)).toBe(false);
    expect(isNewCoinAge(23.9)).toBe(false);
    expect(isNewCoinAge(24)).toBe(true);
    expect(isNewCoinAge(72)).toBe(true);
    expect(isNewCoinAge(168)).toBe(true);
    expect(isNewCoinAge(240)).toBe(true);
    expect(isNewCoinAge(241)).toBe(false);
    expect(isNewCoinAge(null)).toBe(false);
    expect(formatPairAgeHours(36)).toBe('1.5d old');
  });

  it('keeps configurable smart-money and meme-score weights normalized to 1', () => {
    const sm = Object.values(SMART_MONEY_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    const meme = Object.values(MEME_COIN_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sm).toBeCloseTo(1, 8);
    expect(meme).toBeCloseTo(1, 8);
  });
});
