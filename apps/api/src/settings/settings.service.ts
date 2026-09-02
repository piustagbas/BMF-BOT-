import { Injectable } from '@nestjs/common';
import {
  DEFAULT_RISK,
  DEFAULT_TRADING_FLAGS,
  DISCLAIMER,
  SAFETY_WEIGHTS,
  SIGNAL_WEIGHTS,
  TradingMode,
  getVerifiedSmartWallets,
  looksLikeSolanaAddress,
  mergeSmartWallets,
  type SmartWallet,
} from '@memecoinbot/shared';
import { UserSettings, isDbConnected, type IUser } from '@memecoinbot/db';

export type AppSettings = {
  tradingMode: TradingMode;
  beginnerMode: boolean;
  notifyBuySetups: boolean;
  notifyFxSetups: boolean;
  notifyPaperExits: boolean;
  notifyRealTrades: boolean;
  notifyInApp: boolean;
  notifyPush: boolean;
  notifyBuyConfirms: boolean;
  notifySellConfirms: boolean;
  notifyTradeFailed: boolean;
  notifyTakeProfit: boolean;
  notifyStopLoss: boolean;
  expoPushToken: string | null;
  walletProvider: 'phantom' | 'solflare' | 'manual' | null;
  telegramEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  axiomRequiredForAutoTrading: boolean;
  killSwitch: boolean;
  emergencyStop: boolean;
  autoTradingEnabled: boolean;
  /** Demo/paper auto-fill for memecoin BUY setups that pass every hard test. */
  autoTradeMemecoins: boolean;
  /** Token addresses whose passing BUY setups may be auto-filled. */
  autoTradeMemecoinAddresses: string[];
  /** Demo/paper auto-fill for FX setups that pass every hard test. */
  autoTradeForex: boolean;
  /** Public Solana address only — never a private key */
  walletPublicKey: string | null;
  /** User-added smart money wallets (public keys only). */
  trackedWallets: Array<{ address: string; label: string }>;
  maxSlippageBps: number;
  /** When false (default), approved trades never broadcast to chain */
  realTradingBroadcast: boolean;
  disclaimer: string;
};

export type RiskSettingsState = {
  safetyMin: number;
  signalMin: number;
  minLiquidityUsd: number;
  minRiskReward: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  maxDailyTrades: number;
  maxPositionPct: number;
  maxExposurePct: number;
  maxConsecutiveLosses: number;
  cooldownAfterLosingStreakMinutes: number;
  tp1Pct: number;
  tp1SellPct: number;
  tp2Pct: number;
  tp2SellPct: number;
  remainingPct: number;
  trailingMethod: 'ATR' | 'PERCENT' | 'SWING_LOW';
  trailingAtrMult: number;
  trailingPct: number;
  paperBalance: number;
  /** Notional used for manual-real sizing preview when no wallet balance feed */
  realAccountBalanceUsd: number;
  safetyWeights: typeof SAFETY_WEIGHTS;
  signalWeights: typeof SIGNAL_WEIGHTS;
};

function defaultSettings(): AppSettings {
  return {
    tradingMode: DEFAULT_TRADING_FLAGS.tradingMode,
    beginnerMode: true,
    notifyBuySetups: true,
    notifyFxSetups: true,
    notifyPaperExits: true,
    notifyRealTrades: true,
    notifyInApp: true,
    notifyPush: true,
    notifyBuyConfirms: true,
    notifySellConfirms: true,
    notifyTradeFailed: true,
    notifyTakeProfit: true,
    notifyStopLoss: true,
    expoPushToken: null,
    walletProvider: null,
    telegramEnabled: true,
    whatsappEnabled: false,
    emailEnabled: true,
    axiomRequiredForAutoTrading: true,
    killSwitch: DEFAULT_TRADING_FLAGS.killSwitch,
    emergencyStop: false,
    autoTradingEnabled: false,
    autoTradeMemecoins: false,
    autoTradeMemecoinAddresses: [],
    autoTradeForex: false,
    walletPublicKey: null,
    trackedWallets: [],
    maxSlippageBps: 300,
    realTradingBroadcast: false,
    disclaimer: DISCLAIMER,
  };
}

function defaultRisk(): RiskSettingsState {
  return {
    safetyMin: DEFAULT_RISK.safetyMin,
    signalMin: DEFAULT_RISK.signalMin,
    minLiquidityUsd: 25_000,
    minRiskReward: DEFAULT_RISK.minRiskReward,
    riskPerTradePct: DEFAULT_RISK.riskPerTradePct,
    maxDailyLossPct: DEFAULT_RISK.maxDailyLossPct,
    maxOpenPositions: DEFAULT_RISK.maxOpenPositions,
    maxDailyTrades: DEFAULT_RISK.maxDailyTrades,
    maxPositionPct: DEFAULT_RISK.maxPositionPct,
    maxExposurePct: DEFAULT_RISK.maxExposurePct,
    maxConsecutiveLosses: DEFAULT_RISK.maxConsecutiveLosses,
    cooldownAfterLosingStreakMinutes:
      DEFAULT_RISK.cooldownAfterLosingStreakMinutes,
    tp1Pct: DEFAULT_RISK.tp1Pct,
    tp1SellPct: DEFAULT_RISK.tp1SellPct,
    tp2Pct: DEFAULT_RISK.tp2Pct,
    tp2SellPct: DEFAULT_RISK.tp2SellPct,
    remainingPct: DEFAULT_RISK.remainingPct,
    trailingMethod: 'ATR',
    trailingAtrMult: 2,
    trailingPct: 8,
    paperBalance: DEFAULT_RISK.paperBalance,
    realAccountBalanceUsd: 500,
    safetyWeights: { ...SAFETY_WEIGHTS },
    signalWeights: { ...SIGNAL_WEIGHTS },
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function looksLikePubkey(value: string | null | undefined): boolean {
  if (!value) return false;
  // Base58 Solana address length typically 32–44
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

@Injectable()
export class SettingsService {
  private settings: AppSettings = defaultSettings();
  private risk: RiskSettingsState = defaultRisk();

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.settings, ...patch };

    // AUTO mode cannot be enabled via settings API (Phase 8+)
    if (patch.tradingMode === TradingMode.AUTO) {
      next.tradingMode = this.settings.tradingMode;
    }

    // Real-money AUTO stays OFF via this path. Demo auto toggles are allowed below.
    if (patch.autoTradingEnabled === true) {
      next.autoTradingEnabled = false;
    }

    if (patch.autoTradeMemecoins !== undefined) {
      next.autoTradeMemecoins =
        Boolean(patch.autoTradeMemecoins) &&
        next.autoTradeMemecoinAddresses.length > 0 &&
        !next.emergencyStop;
    }
    if (patch.autoTradeMemecoinAddresses !== undefined) {
      next.autoTradeMemecoinAddresses = this.sanitizeMemecoinAddresses(
        patch.autoTradeMemecoinAddresses,
      );
      next.autoTradeMemecoins =
        next.autoTradeMemecoinAddresses.length > 0 && !next.emergencyStop;
    }
    if (patch.autoTradeForex !== undefined) {
      next.autoTradeForex = Boolean(patch.autoTradeForex) && !next.emergencyStop;
    }

    next.axiomRequiredForAutoTrading = true;

    // Broadcast only allowed when env explicitly enables it AND patch requests it
    if (patch.realTradingBroadcast === true) {
      next.realTradingBroadcast =
        process.env.REAL_TRADING_BROADCAST === 'true';
    }

    if (patch.walletPublicKey !== undefined) {
      const pk = patch.walletPublicKey?.trim() || null;
      if (pk && !looksLikePubkey(pk)) {
        next.walletPublicKey = this.settings.walletPublicKey;
      } else {
        next.walletPublicKey = pk;
      }
    }

    if (patch.trackedWallets !== undefined) {
      next.trackedWallets = this.sanitizeTracked(patch.trackedWallets);
    }

    if (patch.maxSlippageBps !== undefined) {
      next.maxSlippageBps = clamp(patch.maxSlippageBps, 10, 2000);
    }

    this.settings = next;
    return this.getSettings();
  }

  setKillSwitch(on: boolean): AppSettings {
    this.settings = { ...this.settings, killSwitch: on };
    return this.getSettings();
  }

  /**
   * Emergency stop: disables auto, blocks new trades, leaves kill switch ON.
   * Does not auto-close positions.
   */
  activateEmergencyStop(): AppSettings {
    this.settings = {
      ...this.settings,
      emergencyStop: true,
      autoTradingEnabled: false,
      autoTradeMemecoins: false,
      autoTradeMemecoinAddresses: [],
      autoTradeForex: false,
      killSwitch: true,
      tradingMode:
        this.settings.tradingMode === TradingMode.AUTO
          ? TradingMode.MANUAL_REAL
          : this.settings.tradingMode,
    };
    return this.getSettings();
  }

  clearEmergencyStop(): AppSettings {
    this.settings = { ...this.settings, emergencyStop: false };
    return this.getSettings();
  }

  /**
   * Dedicated path only — settings PUT cannot enable AUTO.
   * Requires explicit real-money acknowledgements.
   */
  enableAutoTrading(opts: {
    confirmRealMoney: boolean;
    acknowledgeWarning: boolean;
  }): AppSettings {
    if (!opts.confirmRealMoney || !opts.acknowledgeWarning) {
      throw new Error(
        'confirmRealMoney and acknowledgeWarning required. REAL MONEY TRADING ENABLED can result in financial loss.',
      );
    }
    if (this.settings.emergencyStop) {
      throw new Error('Clear emergency stop before enabling auto trading');
    }
    if (!this.settings.walletPublicKey) {
      throw new Error('Set wallet public key before enabling auto trading');
    }
    this.settings = {
      ...this.settings,
      tradingMode: TradingMode.AUTO,
      autoTradingEnabled: true,
      // Kill switch stays as-is; cycle still blocked while ON
    };
    return this.getSettings();
  }

  disableAutoTrading(): AppSettings {
    this.settings = {
      ...this.settings,
      autoTradingEnabled: false,
      tradingMode:
        this.settings.tradingMode === TradingMode.AUTO
          ? TradingMode.MANUAL_REAL
          : this.settings.tradingMode,
    };
    return this.getSettings();
  }

  canPrepareRealTrade(): { ok: boolean; reason: string } {
    const s = this.settings;
    const modeOk =
      s.tradingMode === TradingMode.MANUAL_REAL ||
      (s.tradingMode === TradingMode.AUTO && s.autoTradingEnabled);
    if (!modeOk) {
      return {
        ok: false,
        reason: `Mode is ${s.tradingMode} — need MANUAL_REAL or enabled AUTO`,
      };
    }
    if (s.killSwitch) {
      return { ok: false, reason: 'KILL SWITCH ON — NO REAL TRADES' };
    }
    if (s.emergencyStop) {
      return { ok: false, reason: 'EMERGENCY STOP active' };
    }
    if (!s.walletPublicKey) {
      return { ok: false, reason: 'Wallet public key not set' };
    }
    return { ok: true, reason: 'Ready for user-approved unsigned swap prepare' };
  }

  canRunAutoCycle(): { ok: boolean; reason: string } {
    const s = this.settings;
    if (!s.autoTradingEnabled || s.tradingMode !== TradingMode.AUTO) {
      return { ok: false, reason: 'AUTO TRADING OFF' };
    }
    if (s.killSwitch) {
      return { ok: false, reason: 'KILL SWITCH ON — NO REAL TRADES' };
    }
    if (s.emergencyStop) {
      return { ok: false, reason: 'EMERGENCY STOP active' };
    }
    if (!s.walletPublicKey) {
      return { ok: false, reason: 'Wallet public key not set' };
    }
    return { ok: true, reason: 'Auto cycle allowed (dry-run / prepare-only — no server-side keys)' };
  }

  autoExecutionMode(): 'dry_run' | 'prepare_only' {
    const mode = (process.env.AUTO_EXECUTION_MODE || 'dry_run').toLowerCase();
    return mode === 'prepare_only' ? 'prepare_only' : 'dry_run';
  }

  getRisk(): RiskSettingsState {
    return {
      ...this.risk,
      safetyWeights: { ...this.risk.safetyWeights },
      signalWeights: { ...this.risk.signalWeights },
    };
  }

  updateRisk(patch: Partial<RiskSettingsState>): RiskSettingsState {
    const next: RiskSettingsState = {
      ...this.risk,
      ...patch,
      safetyWeights: {
        ...SAFETY_WEIGHTS,
        ...(patch.safetyWeights ?? this.risk.safetyWeights),
      },
      signalWeights: {
        ...SIGNAL_WEIGHTS,
        ...(patch.signalWeights ?? this.risk.signalWeights),
      },
    };
    next.safetyMin = clamp(next.safetyMin, 0, 100);
    next.signalMin = clamp(next.signalMin, 0, 100);
    next.riskPerTradePct = clamp(next.riskPerTradePct, 0.1, 5);
    next.tp1Pct = clamp(next.tp1Pct, 1, 500);
    next.tp2Pct = clamp(next.tp2Pct, 1, 1000);
    next.tp1SellPct = clamp(next.tp1SellPct, 1, 100);
    next.tp2SellPct = clamp(next.tp2SellPct, 1, 100);
    next.remainingPct = clamp(next.remainingPct, 0, 100);
    next.minRiskReward = clamp(next.minRiskReward, 1, 10);
    next.realAccountBalanceUsd = clamp(next.realAccountBalanceUsd, 1, 1_000_000);
    this.risk = next;
    return this.getRisk();
  }

  resetDefaults() {
    this.settings = defaultSettings();
    this.risk = defaultRisk();
    return { settings: this.getSettings(), risk: this.getRisk() };
  }

  getTrackedWallets(): Array<{ address: string; label: string }> {
    return [...this.settings.trackedWallets];
  }

  listSmartWallets(): { verified: SmartWallet[]; user: SmartWallet[]; all: SmartWallet[] } {
    const verified = getVerifiedSmartWallets(process.env.VERIFIED_SMART_WALLETS);
    const user = mergeSmartWallets([], this.settings.trackedWallets);
    return {
      verified,
      user,
      all: mergeSmartWallets(verified, this.settings.trackedWallets),
    };
  }

  addTrackedWallet(address: string, label?: string): AppSettings {
    const addr = address?.trim();
    if (!looksLikeSolanaAddress(addr)) {
      throw new Error('Valid Solana wallet address required');
    }
    const existing = this.settings.trackedWallets.filter((w) => w.address !== addr);
    if (existing.length >= 20) {
      throw new Error('Maximum 20 user-added smart wallets');
    }
    this.settings = {
      ...this.settings,
      trackedWallets: [
        ...existing,
        {
          address: addr,
          label: label?.trim() || `${addr.slice(0, 4)}…${addr.slice(-4)}`,
        },
      ],
    };
    return this.getSettings();
  }

  removeTrackedWallet(address: string): AppSettings {
    this.settings = {
      ...this.settings,
      trackedWallets: this.settings.trackedWallets.filter((w) => w.address !== address),
    };
    return this.getSettings();
  }

  private sanitizeTracked(
    list: Array<{ address: string; label?: string }> | undefined,
  ): Array<{ address: string; label: string }> {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: Array<{ address: string; label: string }> = [];
    for (const w of list) {
      if (!looksLikeSolanaAddress(w.address) || seen.has(w.address)) continue;
      seen.add(w.address);
      out.push({
        address: w.address.trim(),
        label: w.label?.trim() || `${w.address.slice(0, 4)}…${w.address.slice(-4)}`,
      });
      if (out.length >= 20) break;
    }
    return out;
  }

  /** Load this user's Mongo settings into the live in-memory state. */
  async hydrateFromUser(user: IUser): Promise<{
    settings: AppSettings;
    risk: RiskSettingsState;
  }> {
    if (!isDbConnected()) {
      return { settings: this.getSettings(), risk: this.getRisk() };
    }
    let doc = await UserSettings.findOne({ userId: user._id });
    if (!doc) {
      doc = await UserSettings.create({ userId: user._id });
    }
    this.settings = {
      ...defaultSettings(),
      tradingMode: (doc.tradingMode as TradingMode) || TradingMode.SIGNAL_ONLY,
      beginnerMode: doc.beginnerMode,
      notifyBuySetups: doc.notifyBuySetups,
      notifyFxSetups: doc.notifyFxSetups !== false,
      notifyPaperExits: doc.notifyPaperExits,
      notifyRealTrades: doc.notifyRealTrades,
      notifyInApp: doc.notifyInApp !== false,
      notifyPush: doc.notifyPush !== false,
      notifyBuyConfirms: doc.notifyBuyConfirms !== false,
      notifySellConfirms: doc.notifySellConfirms !== false,
      notifyTradeFailed: doc.notifyTradeFailed !== false,
      notifyTakeProfit: doc.notifyTakeProfit !== false,
      notifyStopLoss: doc.notifyStopLoss !== false,
      expoPushToken: doc.expoPushToken ?? null,
      walletProvider: (doc.walletProvider as AppSettings['walletProvider']) ?? null,
      telegramEnabled: doc.telegramEnabled,
      whatsappEnabled: Boolean(doc.whatsappEnabled),
      emailEnabled: Boolean(doc.emailEnabled),
      killSwitch: doc.killSwitch,
      emergencyStop: doc.emergencyStop,
      autoTradingEnabled: false,
      autoTradeMemecoinAddresses: this.sanitizeMemecoinAddresses(
        doc.autoTradeMemecoinAddresses ?? [],
      ),
      autoTradeMemecoins:
        Boolean(doc.autoTradeMemecoins) &&
        this.sanitizeMemecoinAddresses(doc.autoTradeMemecoinAddresses ?? []).length > 0,
      autoTradeForex: Boolean(doc.autoTradeForex),
      walletPublicKey: doc.walletPublicKey,
      trackedWallets: this.sanitizeTracked(
        (doc.trackedWallets ?? []) as Array<{ address: string; label: string }>,
      ),
      maxSlippageBps: doc.maxSlippageBps,
      axiomRequiredForAutoTrading: true,
      realTradingBroadcast: false,
      disclaimer: DISCLAIMER,
    };
    if (doc.riskJson && typeof doc.riskJson === 'object') {
      this.risk = {
        ...defaultRisk(),
        ...(doc.riskJson as Partial<RiskSettingsState>),
        safetyWeights: { ...SAFETY_WEIGHTS },
        signalWeights: { ...SIGNAL_WEIGHTS },
      };
    }
    return { settings: this.getSettings(), risk: this.getRisk() };
  }

  async persistToUser(user: IUser): Promise<void> {
    if (!isDbConnected()) return;
    const s = this.settings;
    await UserSettings.findOneAndUpdate(
      { userId: user._id },
      {
        userId: user._id,
        tradingMode: s.tradingMode,
        beginnerMode: s.beginnerMode,
        notifyBuySetups: s.notifyBuySetups,
        notifyFxSetups: s.notifyFxSetups,
        notifyPaperExits: s.notifyPaperExits,
        notifyRealTrades: s.notifyRealTrades,
        notifyInApp: s.notifyInApp,
        notifyPush: s.notifyPush,
        notifyBuyConfirms: s.notifyBuyConfirms,
        notifySellConfirms: s.notifySellConfirms,
        notifyTradeFailed: s.notifyTradeFailed,
        notifyTakeProfit: s.notifyTakeProfit,
        notifyStopLoss: s.notifyStopLoss,
        expoPushToken: s.expoPushToken,
        walletProvider: s.walletProvider,
        telegramEnabled: s.telegramEnabled,
        whatsappEnabled: s.whatsappEnabled,
        emailEnabled: s.emailEnabled,
        killSwitch: s.killSwitch,
        emergencyStop: s.emergencyStop,
        autoTradingEnabled: false,
        autoTradeMemecoins: s.autoTradeMemecoinAddresses.length > 0,
        autoTradeMemecoinAddresses: s.autoTradeMemecoinAddresses,
        autoTradeForex: s.autoTradeForex,
        walletPublicKey: s.walletPublicKey,
        trackedWallets: s.trackedWallets,
        maxSlippageBps: s.maxSlippageBps,
        riskJson: this.getRisk() as unknown as Record<string, unknown>,
      },
      { upsert: true },
    );
  }

  private sanitizeMemecoinAddresses(addresses: string[] | undefined): string[] {
    if (!Array.isArray(addresses)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const address of addresses) {
      const value = typeof address === 'string' ? address.trim() : '';
      if (!looksLikeSolanaAddress(value) || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
      if (out.length >= 100) break;
    }
    return out;
  }
}
