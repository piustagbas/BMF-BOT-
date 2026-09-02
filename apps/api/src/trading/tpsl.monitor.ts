import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TpslOrder, User, UserPosition, isDbConnected } from '@memecoinbot/db';
import { fetchDexScreenerToken } from '@memecoinbot/data-providers';
import { SettingsService } from '../settings/settings.service';
import { TradeNotificationsService } from '../notifications/trade-notifications.service';
import { roiPct, shouldTriggerStopLoss, shouldTriggerTakeProfit } from './tpsl.logic';

const POLL_MS = 20_000;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

@Injectable()
export class TpslMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TpslMonitorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly tradeNotes: TradeNotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (!isDbConnected()) return;
    const orders = await TpslOrder.find({ status: 'ACTIVE' }).limit(40);
    for (const order of orders) {
      try {
        await this.checkOrder(order);
      } catch (err) {
        this.logger.warn(
          `TP/SL check failed ${order.symbol}: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
  }

  private async checkOrder(order: InstanceType<typeof TpslOrder>) {
    const snap = await fetchDexScreenerToken(order.tokenAddress);
    const price = snap.ok && snap.data?.priceUsd != null ? snap.data.priceUsd : null;
    if (price == null) return;

    const pos = await UserPosition.findById(order.positionId);
    if (!pos || pos.status !== 'OPEN' || pos.qty <= 0) {
      order.status = 'CANCELLED';
      await order.save();
      return;
    }

    pos.lastPrice = price;
    await pos.save();

    const hit =
      order.kind === 'TAKE_PROFIT'
        ? shouldTriggerTakeProfit(order.entryPrice, price, order.triggerPct)
        : shouldTriggerStopLoss(order.entryPrice, price, order.triggerPct);
    if (!hit) return;

    const now = Date.now();
    if (order.lastAlertAt && now - order.lastAlertAt.getTime() < ALERT_COOLDOWN_MS) {
      return;
    }

    order.status = 'TRIGGERED';
    order.triggeredAt = new Date();
    order.lastAlertAt = new Date();
    await order.save();

    const user = await User.findById(order.userId);
    if (!user) return;
    await this.settings.hydrateFromUser(user);

    await this.tradeNotes.emit(user, {
      kind: order.kind === 'TAKE_PROFIT' ? 'TAKE_PROFIT' : 'STOP_LOSS',
      eventId: `tpsl:${String(order._id)}:${order.triggeredAt.getTime()}`,
      symbol: order.symbol,
      tokenAddress: order.tokenAddress,
      entryPrice: order.entryPrice,
      currentPrice: price,
      takeProfitPct: order.kind === 'TAKE_PROFIT' ? order.triggerPct : undefined,
      stopLossPct: order.kind === 'STOP_LOSS' ? order.triggerPct : undefined,
      roiPct: roiPct(order.entryPrice, price),
    });
    this.logger.log(
      `${order.kind} ALERT ${order.symbol} entry=${order.entryPrice} current=${price} (alert only, not executed)`,
    );
  }
}
