import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  applyTestEvent,
  computePaperPerformance,
  createPaperAccount,
  openPaperPosition,
  processPriceUpdate,
  type PaperAccountState,
  type PaperTestEvent,
} from '@memecoinbot/paper-engine';
import { DEFAULT_RISK, TradingMode } from '@memecoinbot/shared';
import { fetchDexScreenerToken } from '@memecoinbot/data-providers';
import { SignalsService } from '../signals/signals.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaperService {
  private readonly logger = new Logger(PaperService.name);
  private account: PaperAccountState = createPaperAccount(DEFAULT_RISK.paperBalance);
  private readonly tradingMode: TradingMode = TradingMode.PAPER;

  constructor(
    private readonly signalsService: SignalsService,
    private readonly settingsService: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  private paperConfig() {
    const risk = this.settingsService.getRisk();
    return {
      riskPct: risk.riskPerTradePct,
      maxOpenPositions: risk.maxOpenPositions,
      maxDailyTrades: risk.maxDailyTrades,
      maxDailyLossPct: risk.maxDailyLossPct,
      maxExposurePct: risk.maxExposurePct,
      maxConsecutiveLosses: risk.maxConsecutiveLosses,
      tp1SellPct: risk.tp1SellPct,
      tp2SellPct: risk.tp2SellPct,
      remainingPct: risk.remainingPct,
      trailingMethod: risk.trailingMethod,
      trailingAtrMult: risk.trailingAtrMult,
      trailingPct: risk.trailingPct,
    };
  }

  private async notifyFromEvents(events: string[]) {
    for (const event of events) {
      const parts = event.split(' ');
      const symbol = parts[parts.length - 1] ?? 'TOKEN';
      if (event.includes('TP1 HIT')) {
        await this.notifications.notifyPaperExit({ kind: 'TP1', symbol });
      } else if (event.includes('TP2 HIT')) {
        await this.notifications.notifyPaperExit({ kind: 'TP2', symbol });
      } else if (event.startsWith('TRAILING_STOP')) {
        await this.notifications.notifyPaperExit({ kind: 'TRAILING_STOP', symbol });
      } else if (event.startsWith('STOP_LOSS')) {
        await this.notifications.notifyPaperExit({ kind: 'STOP_LOSS', symbol });
      }
    }
  }

  getAccount() {
    return {
      ...this.account,
      tradingMode: this.tradingMode,
      note: 'Paper trading only — no blockchain transactions',
    };
  }

  getPerformance() {
    return computePaperPerformance(this.account);
  }

  getPositions() {
    return {
      items: this.account.positions,
      count: this.account.positions.length,
    };
  }

  getTrades() {
    return {
      items: this.account.closedTrades,
      count: this.account.closedTrades.length,
    };
  }

  reset(startingBalance?: number) {
    const bal =
      startingBalance ?? this.settingsService.getRisk().paperBalance ?? DEFAULT_RISK.paperBalance;
    this.account = createPaperAccount(bal);
    return this.getAccount();
  }

  async openFromSignal(address: string) {
    const signal = await this.signalsService.generateForAddress(address);
    if (signal.signalType === 'NO_TRADE') {
      throw new BadRequestException(
        `Cannot paper-trade: NO TRADE. ${signal.failedChecks.join('; ') || signal.beginner.decision}`,
      );
    }
    if (signal.signalType !== 'BUY') {
      throw new BadRequestException(
        `Paper open requires BUY signal (got ${signal.signalType}). Failed: ${signal.failedChecks.join('; ') || 'filters not met'}`,
      );
    }
    if (!signal.levels.entryValid) {
      throw new BadRequestException('ENTRY INVALIDATED');
    }

    const result = openPaperPosition(this.account, {
      tokenAddress: signal.token.address,
      symbol: signal.token.symbol,
      entryPrice: signal.levels.idealEntry,
      stopLoss: signal.levels.stopLoss,
      tp1Price: signal.levels.tp1Price,
      tp2Price: signal.levels.tp2Price,
      strategy: signal.strategy?.name,
      safetyScore: signal.safetyScore,
      signalScore: signal.signalScore,
      entryReason: signal.strategy?.reason ?? 'BUY setup',
      atr: signal.indicators.primary.atr,
      trailingEnabled: true,
      config: this.paperConfig(),
    });

    if (result.error || !result.position) {
      throw new BadRequestException(result.error ?? 'Failed to open paper position');
    }

    this.account = result.account;
    this.logger.log(
      `Paper OPEN ${result.position.symbol} size$${result.position.sizeUsd.toFixed(2)}`,
    );
    return {
      position: result.position,
      account: this.getAccount(),
      signalType: signal.signalType,
      disclaimer: signal.disclaimer,
    };
  }

  async openManual(body: {
    address: string;
    entryPrice?: number;
    stopLoss: number;
    tp1Price: number;
    tp2Price: number;
    symbol?: string;
  }) {
    const market = await fetchDexScreenerToken(body.address);
    const price =
      body.entryPrice ??
      (market.ok ? market.data?.priceUsd ?? undefined : undefined);
    if (price == null) {
      throw new BadRequestException('Entry price unavailable');
    }

    const result = openPaperPosition(this.account, {
      tokenAddress: body.address,
      symbol: body.symbol ?? market.data?.symbol ?? 'UNK',
      entryPrice: price,
      stopLoss: body.stopLoss,
      tp1Price: body.tp1Price,
      tp2Price: body.tp2Price,
      entryReason: 'Manual paper entry (test)',
      trailingEnabled: true,
      config: this.paperConfig(),
    });
    if (result.error || !result.position) {
      throw new BadRequestException(result.error ?? 'Failed to open');
    }
    this.account = result.account;
    return { position: result.position, account: this.getAccount() };
  }

  async syncPrices() {
    const events: string[] = [];
    for (const pos of [...this.account.positions]) {
      const market = await fetchDexScreenerToken(pos.tokenAddress);
      if (!market.ok || market.data?.priceUsd == null) {
        events.push(`Price unavailable for ${pos.symbol}`);
        continue;
      }
      const result = processPriceUpdate(
        this.account,
        pos.tokenAddress,
        market.data.priceUsd,
        this.paperConfig(),
      );
      this.account = result.account;
      events.push(...result.events);
      await this.notifyFromEvents(result.events);
    }
    return {
      events,
      positions: this.getPositions(),
      performance: this.getPerformance(),
      account: this.getAccount(),
    };
  }

  async applyTest(positionId: string, event: PaperTestEvent) {
    const result = applyTestEvent(this.account, positionId, event, this.paperConfig());
    if (result.error) throw new NotFoundException(result.error);
    this.account = result.account;
    await this.notifyFromEvents(result.events);
    return {
      events: result.events,
      positions: this.getPositions(),
      trades: this.getTrades(),
      performance: this.getPerformance(),
      account: this.getAccount(),
    };
  }
}
