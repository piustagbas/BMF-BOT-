import { describe, expect, it } from 'vitest';
import { TradingMode } from '@memecoinbot/shared';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  it('defaults Telegram and email alerts ON so BUY setups notify', () => {
    const svc = new SettingsService();
    const s = svc.getSettings();
    expect(s.notifyBuySetups).toBe(true);
    expect(s.notifyFxSetups).toBe(true);
    expect(s.telegramEnabled).toBe(true);
    expect(s.emailEnabled).toBe(true);
  });

  it('blocks AUTO trading mode updates via settings PUT', () => {
    const svc = new SettingsService();
    const before = svc.getSettings().tradingMode;
    const after = svc.updateSettings({ tradingMode: TradingMode.AUTO });
    expect(after.tradingMode).toBe(before);
    expect(after.tradingMode).not.toBe(TradingMode.AUTO);
    expect(after.axiomRequiredForAutoTrading).toBe(true);
  });

  it('updates risk thresholds with clamps', () => {
    const svc = new SettingsService();
    const risk = svc.updateRisk({ safetyMin: 95, riskPerTradePct: 99 });
    expect(risk.safetyMin).toBe(95);
    expect(risk.riskPerTradePct).toBe(5);
  });

  it('allows PAPER and MANUAL_REAL modes', () => {
    const svc = new SettingsService();
    expect(svc.updateSettings({ tradingMode: TradingMode.PAPER }).tradingMode).toBe(
      TradingMode.PAPER,
    );
    expect(
      svc.updateSettings({ tradingMode: TradingMode.MANUAL_REAL }).tradingMode,
    ).toBe(TradingMode.MANUAL_REAL);
  });

  it('defaults kill switch ON and blocks prepare until cleared', () => {
    const svc = new SettingsService();
    expect(svc.getSettings().killSwitch).toBe(true);
    svc.updateSettings({
      tradingMode: TradingMode.MANUAL_REAL,
      walletPublicKey: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    });
    expect(svc.canPrepareRealTrade().ok).toBe(false);
    svc.setKillSwitch(false);
    expect(svc.canPrepareRealTrade().ok).toBe(true);
  });

  it('emergency stop forces kill switch and disables auto', () => {
    const svc = new SettingsService();
    svc.setKillSwitch(false);
    svc.activateEmergencyStop();
    const s = svc.getSettings();
    expect(s.emergencyStop).toBe(true);
    expect(s.killSwitch).toBe(true);
    expect(s.autoTradingEnabled).toBe(false);
  });

  it('rejects autoTradingEnabled=true via settings PUT', () => {
    const svc = new SettingsService();
    const s = svc.updateSettings({ autoTradingEnabled: true });
    expect(s.autoTradingEnabled).toBe(false);
  });

  it('rejects invalid wallet public keys', () => {
    const svc = new SettingsService();
    const s = svc.updateSettings({ walletPublicKey: 'not-a-key' });
    expect(s.walletPublicKey).toBeNull();
  });

  it('stores user-added smart money wallets', () => {
    const svc = new SettingsService();
    svc.addTrackedWallet('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'Test wallet');
    const listed = svc.listSmartWallets();
    expect(listed.user).toHaveLength(1);
    expect(listed.user[0]?.label).toBe('Test wallet');
    expect(() => svc.addTrackedWallet('nope')).toThrow(/Valid Solana/);
  });

  it('enables AUTO only with dual confirmation and wallet', () => {
    const svc = new SettingsService();
    expect(() =>
      svc.enableAutoTrading({ confirmRealMoney: true, acknowledgeWarning: true }),
    ).toThrow(/wallet/i);

    svc.updateSettings({
      walletPublicKey: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    });
    expect(() =>
      svc.enableAutoTrading({ confirmRealMoney: false, acknowledgeWarning: true }),
    ).toThrow(/confirmRealMoney/i);

    const s = svc.enableAutoTrading({
      confirmRealMoney: true,
      acknowledgeWarning: true,
    });
    expect(s.autoTradingEnabled).toBe(true);
    expect(s.tradingMode).toBe(TradingMode.AUTO);
    expect(svc.canRunAutoCycle().ok).toBe(false);

    svc.setKillSwitch(false);
    expect(svc.canRunAutoCycle().ok).toBe(true);

    svc.disableAutoTrading();
    expect(svc.getSettings().autoTradingEnabled).toBe(false);
    expect(svc.getSettings().tradingMode).toBe(TradingMode.MANUAL_REAL);
  });

  it('keeps memecoin auto-trade disabled without a selected token', () => {
    const svc = new SettingsService();
    expect(svc.getSettings().autoTradeMemecoins).toBe(false);
    expect(svc.getSettings().autoTradeForex).toBe(false);

    const on = svc.updateSettings({ autoTradeMemecoins: true, autoTradeForex: true });
    expect(on.autoTradeMemecoins).toBe(false);
    expect(on.autoTradeForex).toBe(true);
    expect(on.autoTradingEnabled).toBe(false);

    svc.activateEmergencyStop();
    expect(svc.getSettings().autoTradeMemecoins).toBe(false);
    expect(svc.getSettings().autoTradeForex).toBe(false);
  });

  it('stores memecoin auto-trade selections per token address', () => {
    const svc = new SettingsService();
    const address = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const s = svc.updateSettings({ autoTradeMemecoinAddresses: [address, address, 'invalid'] });
    expect(s.autoTradeMemecoinAddresses).toEqual([address]);
    expect(s.autoTradeMemecoins).toBe(true);

    const off = svc.updateSettings({ autoTradeMemecoinAddresses: [] });
    expect(off.autoTradeMemecoinAddresses).toEqual([]);
    expect(off.autoTradeMemecoins).toBe(false);
  });
});
