import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppNotification,
  isDbConnected,
  type IUser,
  type NotificationType,
} from '@memecoinbot/db';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  eventTypeForKind,
  formatTelegramTrade,
  formatTradeEvent,
  type TradeEventKind,
  type TradeEventPayload,
} from './trade-events';

export type NotificationPreferenceState = {
  inApp: boolean;
  push: boolean;
  telegram: boolean;
  buy: boolean;
  sell: boolean;
  confirmation: boolean;
  failure: boolean;
  takeProfit: boolean;
  stopLoss: boolean;
};

const DEFAULT_PREFS: NotificationPreferenceState = {
  inApp: true,
  push: true,
  telegram: true,
  buy: true,
  sell: true,
  confirmation: true,
  failure: true,
  takeProfit: true,
  stopLoss: true,
};

function prefsFromSettings(s: {
  notifyInApp?: boolean;
  notifyPush?: boolean;
  telegramEnabled?: boolean;
  notifyBuyConfirms?: boolean;
  notifySellConfirms?: boolean;
  notifyTradeFailed?: boolean;
  notifyTakeProfit?: boolean;
  notifyStopLoss?: boolean;
  notifyRealTrades?: boolean;
}): NotificationPreferenceState {
  return {
    inApp: s.notifyInApp !== false,
    push: s.notifyPush !== false,
    telegram: s.telegramEnabled !== false,
    buy: s.notifyBuyConfirms !== false,
    sell: s.notifySellConfirms !== false,
    confirmation: s.notifyRealTrades !== false,
    failure: s.notifyTradeFailed !== false,
    takeProfit: s.notifyTakeProfit !== false,
    stopLoss: s.notifyStopLoss !== false,
  };
}

function kindAllowed(
  kind: TradeEventKind,
  prefs: NotificationPreferenceState,
  side?: 'BUY' | 'SELL',
): boolean {
  switch (kind) {
    case 'BUY_CONFIRMED':
      return prefs.buy && prefs.confirmation;
    case 'SELL_CONFIRMED':
      return prefs.sell && prefs.confirmation;
    case 'TX_CONFIRMED':
      return prefs.confirmation;
    case 'TX_PENDING':
      return prefs.confirmation || prefs.buy || prefs.sell;
    case 'TX_FAILED':
      return prefs.failure;
    case 'TAKE_PROFIT':
      return prefs.takeProfit;
    case 'STOP_LOSS':
      return prefs.stopLoss;
    case 'SELL_SUBMITTED':
      return prefs.sell;
    case 'TRADE_SUCCEEDED':
      return side ? payloadSideAllowed(side, prefs) : prefs.confirmation;
    case 'TRADE_FAILED':
      return prefs.failure;
    case 'TRADE_PROFIT':
      return prefs.confirmation;
    case 'TRADE_LOSS':
      return prefs.failure;
    default:
      return true;
  }
}

function payloadSideAllowed(
  side: 'BUY' | 'SELL',
  prefs: NotificationPreferenceState,
): boolean {
  return side === 'BUY' ? prefs.buy && prefs.confirmation : prefs.sell && prefs.confirmation;
}

@Injectable()
export class TradeNotificationsService {
  private readonly logger = new Logger(TradeNotificationsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  getPreferences(): NotificationPreferenceState {
    const s = this.settings.getSettings() as ReturnType<SettingsService['getSettings']> & {
      notifyInApp?: boolean;
      notifyPush?: boolean;
      notifyBuyConfirms?: boolean;
      notifySellConfirms?: boolean;
      notifyTradeFailed?: boolean;
      notifyTakeProfit?: boolean;
      notifyStopLoss?: boolean;
    };
    return prefsFromSettings(s);
  }

  async prefsForUser(user: IUser): Promise<NotificationPreferenceState> {
    await this.settings.hydrateFromUser(user);
    return this.getPreferences();
  }

  async updatePreferences(
    user: IUser,
    patch: Partial<NotificationPreferenceState>,
  ): Promise<NotificationPreferenceState> {
    await this.settings.hydrateFromUser(user);
    this.settings.updateSettings({
      notifyInApp: patch.inApp,
      notifyPush: patch.push,
      telegramEnabled: patch.telegram,
      notifyBuyConfirms: patch.buy,
      notifySellConfirms: patch.sell,
      notifyRealTrades: patch.confirmation,
      notifyTradeFailed: patch.failure,
      notifyTakeProfit: patch.takeProfit,
      notifyStopLoss: patch.stopLoss,
    } as Parameters<SettingsService['updateSettings']>[0]);
    await this.settings.persistToUser(user);
    return this.getPreferences();
  }

  async emit(user: IUser | null, payload: TradeEventPayload): Promise<{ delivered: boolean; duplicate: boolean }> {
    if (!payload.eventId) {
      return { delivered: false, duplicate: false };
    }
    if (user) {
      await this.settings.hydrateFromUser(user);
    }
    if (!isDbConnected()) {
      await this.prisma.tryConnect();
    }
    if (isDbConnected()) {
      const existing = await AppNotification.findOne({ eventId: payload.eventId }).lean();
      if (existing) {
        return { delivered: false, duplicate: true };
      }
    }

    const prefs = this.getPreferences();
    if (!kindAllowed(payload.kind, prefs, payload.side)) {
      return { delivered: false, duplicate: false };
    }

    const inApp = formatTradeEvent(payload);
    const telegram = formatTelegramTrade(payload);
    const type = eventTypeForKind(payload.kind) as NotificationType;
    const action = payload.tokenAddress
      ? {
          label:
            payload.kind === 'TAKE_PROFIT' || payload.kind === 'STOP_LOSS'
              ? 'SELL NOW'
              : 'Open token',
          screen: 'TokenDetails',
          params: { address: payload.tokenAddress },
        }
      : null;

    if (user && prefs.inApp && isDbConnected()) {
      try {
        await AppNotification.create({
          userId: user._id,
          eventId: payload.eventId,
          type,
          title: inApp.title,
          body: inApp.body,
          tokenAddress: payload.tokenAddress ?? null,
          symbol: payload.symbol,
          tradeId: payload.tradeId ?? null,
          positionId: null,
          action,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (/duplicate|e11000/i.test(msg)) {
          return { delivered: false, duplicate: true };
        }
        this.logger.warn(`Inbox persist failed: ${msg}`);
      }
    }

    if (prefs.telegram) {
      await this.notifications.notify(telegram.title, telegram.body);
    } else if (prefs.inApp) {
      await this.notifications.notify(inApp.title, inApp.body);
    }

    if (prefs.push) {
      const token = this.settings.getSettings().expoPushToken;
      if (token) {
        await this.sendExpoPush(token, inApp.title, inApp.body, payload.eventId, {
          type,
          tokenAddress: payload.tokenAddress ?? null,
          tradeId: payload.tradeId ?? null,
        });
      }
    }

    return { delivered: true, duplicate: false };
  }

  async inbox(user: IUser, limit = 50) {
    if (!isDbConnected()) {
      return { items: [], count: 0, unread: 0 };
    }
    const cap = Math.min(Math.max(limit, 1), 100);
    const items = await AppNotification.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(cap)
      .lean();
    const unread = await AppNotification.countDocuments({
      userId: user._id,
      readAt: null,
    });
    return {
      items: items.map((n) => ({
        id: String(n._id),
        eventId: n.eventId,
        type: n.type,
        title: n.title,
        body: n.body,
        tokenAddress: n.tokenAddress,
        symbol: n.symbol,
        tradeId: n.tradeId,
        action: n.action,
        read: Boolean(n.readAt),
        createdAt: n.createdAt.toISOString(),
      })),
      count: items.length,
      unread,
    };
  }

  async markRead(user: IUser, id: string) {
    if (!isDbConnected()) return { ok: false };
    await AppNotification.updateOne(
      { _id: id, userId: user._id },
      { $set: { readAt: new Date() } },
    );
    return { ok: true };
  }

  async markAllRead(user: IUser) {
    if (!isDbConnected()) return { ok: false };
    await AppNotification.updateMany(
      { userId: user._id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return { ok: true };
  }

  async savePushToken(user: IUser, token: string) {
    await this.settings.hydrateFromUser(user);
    this.settings.updateSettings({ expoPushToken: token } as Parameters<
      SettingsService['updateSettings']
    >[0]);
    await this.settings.persistToUser(user);
    return { ok: true };
  }

  private async sendExpoPush(
    to: string,
    title: string,
    body: string,
    eventId: string,
    data: Record<string, unknown>,
  ) {
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            to,
            title,
            body: body.slice(0, 400),
            sound: 'default',
            data: { eventId, ...data },
          },
        ]),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push HTTP ${res.status}`);
      }
    } catch (err) {
      this.logger.warn(
        `Expo push failed: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  }
}

export { DEFAULT_PREFS, kindAllowed, prefsFromSettings };
