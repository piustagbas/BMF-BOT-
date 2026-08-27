import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DISCLAIMER, TradingMode } from '@memecoinbot/shared';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SignalsService } from '../signals/signals.service';
import { TradingService, type TradeProposal } from './trading.service';

export type AutoCycleResult = {
  ranAt: string;
  autoTradingEnabled: boolean;
  killSwitch: boolean;
  emergencyStop: boolean;
  executionMode: 'dry_run' | 'prepare_only';
  gate: { ok: boolean; reason: string };
  scanned: number;
  buySignals: number;
  queued: TradeProposal[];
  blocked: Array<{ address: string; symbol?: string; reason: string }>;
  note: string;
  disclaimer: string;
};

@Injectable()
export class AutoTradingService {
  private readonly logger = new Logger(AutoTradingService.name);
  private lastCycle: AutoCycleResult | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly signals: SignalsService,
    private readonly trading: TradingService,
    private readonly notifications: NotificationsService,
  ) {}

  getStatus() {
    const s = this.settings.getSettings();
    const gate = this.settings.canRunAutoCycle();
    const prepareGate = this.settings.canPrepareRealTrade();
    return {
      tradingMode: s.tradingMode,
      autoTradingEnabled: s.autoTradingEnabled,
      killSwitch: s.killSwitch,
      emergencyStop: s.emergencyStop,
      walletPublicKey: s.walletPublicKey
        ? `${s.walletPublicKey.slice(0, 4)}…${s.walletPublicKey.slice(-4)}`
        : null,
      realTradingBroadcast: s.realTradingBroadcast,
      axiomRequiredForAutoTrading: s.axiomRequiredForAutoTrading,
      executionMode: this.settings.autoExecutionMode(),
      label: s.autoTradingEnabled ? 'AUTO TRADING ON' : 'AUTO TRADING OFF',
      killSwitchLabel: s.killSwitch ? 'KILL SWITCH ON' : 'KILL SWITCH OFF',
      warning: s.autoTradingEnabled
        ? 'REAL MONEY TRADING ENABLED. Trading can result in financial loss.'
        : null,
      canExecuteRealTrades: false,
      canRunAutoCycle: gate.ok,
      canPrepareManualTrade: prepareGate.ok && s.tradingMode === TradingMode.MANUAL_REAL,
      lastCycleAt: this.lastCycle?.ranAt ?? null,
      reason: [
        s.autoTradingEnabled ? 'Auto trading enabled' : 'AUTO TRADING OFF',
        s.killSwitch ? 'Kill switch active — NO REAL TRADES' : null,
        s.emergencyStop ? 'Emergency stop active' : null,
        s.tradingMode !== TradingMode.AUTO && s.autoTradingEnabled
          ? `Mode is ${s.tradingMode}`
          : null,
        !s.walletPublicKey ? 'Wallet not set' : null,
        s.axiomRequiredForAutoTrading
          ? 'Axiom required for auto — blocked while AXIOM DATA UNAVAILABLE'
          : null,
        `Execution mode: ${this.settings.autoExecutionMode()} (no server private keys)`,
        'Server never auto-broadcasts signed txs without an external signer',
      ]
        .filter(Boolean)
        .join('; '),
    };
  }

  enable(body: { confirmRealMoney?: boolean; acknowledgeWarning?: boolean }) {
    try {
      const settings = this.settings.enableAutoTrading({
        confirmRealMoney: Boolean(body.confirmRealMoney),
        acknowledgeWarning: Boolean(body.acknowledgeWarning),
      });
      void this.notifications.notify(
        'AUTO TRADING ON',
        [
          'REAL MONEY TRADING ENABLED',
          '',
          'Trading can result in financial loss.',
          '',
          `Kill switch: ${settings.killSwitch ? 'ON' : 'OFF'}`,
          `Execution mode: ${this.settings.autoExecutionMode()}`,
          'Axiom still required — auto entries blocked while AXIOM DATA UNAVAILABLE.',
          '',
          DISCLAIMER,
        ].join('\n'),
      );
      return {
        ...this.getStatus(),
        warningBanner: 'REAL MONEY TRADING ENABLED. Trading can result in financial loss.',
      };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to enable auto trading',
      );
    }
  }

  disable() {
    this.settings.disableAutoTrading();
    void this.notifications.notify(
      'AUTO TRADING OFF',
      'Auto trading disabled. Manual approval still required for real trades.\n\n' +
        DISCLAIMER,
    );
    return this.getStatus();
  }

  emergencyStop() {
    const settings = this.settings.activateEmergencyStop();
    void this.notifications.notify(
      'EMERGENCY STOP',
      [
        'Emergency stop activated.',
        'Auto trading disabled.',
        'New trades blocked.',
        'Existing positions were NOT auto-closed.',
        '',
        DISCLAIMER,
      ].join('\n'),
    );
    return {
      settings,
      status: this.getStatus(),
      message:
        'Emergency stop activated. Auto trading disabled. New real trades blocked. Positions not auto-closed.',
    };
  }

  getLastCycle() {
    return this.lastCycle;
  }

  async runCycle(opts?: { limit?: number }): Promise<AutoCycleResult> {
    const limit = Math.min(Math.max(opts?.limit ?? 5, 1), 10);
    const s = this.settings.getSettings();
    const gate = this.settings.canRunAutoCycle();
    const executionMode = this.settings.autoExecutionMode();
    const ranAt = new Date().toISOString();

    if (!gate.ok) {
      const result: AutoCycleResult = {
        ranAt,
        autoTradingEnabled: s.autoTradingEnabled,
        killSwitch: s.killSwitch,
        emergencyStop: s.emergencyStop,
        executionMode,
        gate,
        scanned: 0,
        buySignals: 0,
        queued: [],
        blocked: [{ address: '-', reason: gate.reason }],
        note: 'Auto cycle not run — gate failed. DO NOT EXECUTE.',
        disclaimer: DISCLAIMER,
      };
      this.lastCycle = result;
      return result;
    }

    this.logger.log(`Auto cycle start limit=${limit} mode=${executionMode}`);
    const signals = await this.signals.scanTop(limit);
    const queued: TradeProposal[] = [];
    const blocked: AutoCycleResult['blocked'] = [];
    let buySignals = 0;

    for (const signal of signals) {
      if (signal.signalType !== 'BUY') {
        blocked.push({
          address: signal.token.address,
          symbol: signal.token.symbol,
          reason: `Signal ${signal.signalType} — skipped`,
        });
        continue;
      }
      buySignals += 1;

      try {
        const proposal = await this.trading.propose(signal.token.address, {
          source: 'AUTO',
          preTradeMode: 'AUTO',
        });

        if (!proposal.preTrade.allowed) {
          blocked.push({
            address: signal.token.address,
            symbol: signal.token.symbol,
            reason: proposal.preTrade.failed.join('; ') || 'AUTO pre-trade failed',
          });
          continue;
        }

        const handled = await this.trading.autoAcceptProposal(proposal.id, {
          executionMode,
        });
        queued.push(handled);
      } catch (err) {
        blocked.push({
          address: signal.token.address,
          symbol: signal.token.symbol,
          reason: err instanceof Error ? err.message : 'auto propose failed',
        });
      }
    }

    const result: AutoCycleResult = {
      ranAt,
      autoTradingEnabled: true,
      killSwitch: s.killSwitch,
      emergencyStop: s.emergencyStop,
      executionMode,
      gate,
      scanned: signals.length,
      buySignals,
      queued,
      blocked,
      note:
        executionMode === 'dry_run'
          ? 'Dry-run only: passed setups marked AUTO_DRY_RUN — no chain broadcast. No private keys on server.'
          : 'Prepare-only: unsigned swaps built for wallet signing — still no auto-broadcast.',
      disclaimer: DISCLAIMER,
    };
    this.lastCycle = result;

    if (queued.length > 0) {
      await this.notifications.notify(
        `AUTO CYCLE ${queued.length} setup(s)`,
        [
          `Scanned ${signals.length}, BUY ${buySignals}, queued ${queued.length}.`,
          `Mode: ${executionMode}`,
          '',
          ...queued.map(
            (q) => `$${q.symbol} ${q.status} $${q.positionSizeUsd.toFixed(2)}`,
          ),
          '',
          DISCLAIMER,
        ].join('\n'),
      );
    }

    return result;
  }
}
