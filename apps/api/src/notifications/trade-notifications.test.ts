import { describe, expect, it } from 'vitest';
import { kindAllowed, prefsFromSettings } from './trade-notifications.service';

describe('notification preferences', () => {
  it('defaults channels and trade events on', () => {
    const prefs = prefsFromSettings({});
    expect(prefs.inApp).toBe(true);
    expect(prefs.push).toBe(true);
    expect(prefs.telegram).toBe(true);
    expect(prefs.buy).toBe(true);
  });

  it('honors per-event and per-channel toggles', () => {
    const prefs = prefsFromSettings({
      notifyInApp: true,
      notifyPush: false,
      telegramEnabled: false,
      notifyBuyConfirms: false,
      notifySellConfirms: true,
      notifyTradeFailed: false,
      notifyTakeProfit: true,
      notifyStopLoss: false,
      notifyRealTrades: true,
    });
    expect(kindAllowed('BUY_CONFIRMED', prefs)).toBe(false);
    expect(kindAllowed('SELL_CONFIRMED', prefs)).toBe(true);
    expect(kindAllowed('TX_FAILED', prefs)).toBe(false);
    expect(kindAllowed('TRADE_PROFIT', prefs)).toBe(true);
    expect(kindAllowed('TRADE_LOSS', prefs)).toBe(false);
    expect(kindAllowed('TAKE_PROFIT', prefs)).toBe(true);
    expect(kindAllowed('STOP_LOSS', prefs)).toBe(false);
    expect(prefs.push).toBe(false);
    expect(prefs.telegram).toBe(false);
  });
});
