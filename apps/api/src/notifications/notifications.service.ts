import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { DISCLAIMER, dexScreenerSolanaUrl } from '@memecoinbot/shared';
import { UserSettings, isDbConnected } from '@memecoinbot/db';
import { SettingsService } from '../settings/settings.service';
import { RedisService } from '../redis/redis.service';
import { NOTIFICATIONS_QUEUE } from '../redis/redis.module';
import type { NotificationJobData } from './notifications.processor';
import {
  activeAlertChannels,
  healPatchForConfigured,
  mergeChannelFlags,
  shouldSkipBuyAlert,
  type ChannelFlags,
} from './alertChannels';

export type AppNotification = {
  id: string;
  channel: 'telegram' | 'whatsapp' | 'email' | 'in_app';
  title: string;
  body: string;
  sentAt: string;
  delivered: boolean;
  queued?: boolean;
  error?: string;
};

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly items: AppNotification[] = [];
  private readonly buyAlertSentAt = new Map<string, number>();
  private readonly fxAlertSentAt = new Map<string, number>();
  private channelsHealed = false;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue: Queue<NotificationJobData>,
  ) {}

  async onModuleInit() {
    await this.healChannelDefaultsOnce();
  }

  list(limit = 50) {
    return {
      items: this.items.slice(0, Math.min(Math.max(limit, 1), 100)),
      count: this.items.length,
      telegramConfigured: this.isTelegramConfigured(),
      whatsappConfigured: this.isWhatsAppConfigured(),
      emailConfigured: this.isEmailConfigured(),
      redis: undefined as undefined,
    };
  }

  async status() {
    const [telegram, whatsapp, email, redis] = await Promise.all([
      this.pingTelegram(),
      this.pingWhatsApp(),
      this.pingEmail(),
      this.redis.ping(),
    ]);
    const flags = await this.resolveChannelFlags();
    return {
      telegramConfigured: this.isTelegramConfigured(),
      telegramEnabled: flags.telegramEnabled,
      telegram,
      whatsappConfigured: this.isWhatsAppConfigured(),
      whatsappEnabled: flags.whatsappEnabled,
      whatsapp,
      emailConfigured: this.isEmailConfigured(),
      emailEnabled: flags.emailEnabled,
      email,
      redis,
      queueName: NOTIFICATIONS_QUEUE,
      recentCount: this.items.length,
    };
  }

  isTelegramConfigured(): boolean {
    return Boolean(
      this.config.get<string>('TELEGRAM_BOT_TOKEN') &&
        this.config.get<string>('TELEGRAM_CHAT_ID'),
    );
  }

  isWhatsAppConfigured(): boolean {
    const provider = (this.config.get<string>('WHATSAPP_PROVIDER') || 'meta').toLowerCase();
    if (provider === 'twilio') {
      return Boolean(
        this.config.get<string>('TWILIO_ACCOUNT_SID') &&
          this.config.get<string>('TWILIO_AUTH_TOKEN') &&
          this.config.get<string>('TWILIO_WHATSAPP_FROM') &&
          this.config.get<string>('WHATSAPP_TO'),
      );
    }
    return Boolean(
      this.config.get<string>('WHATSAPP_TOKEN') &&
        this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID') &&
        this.config.get<string>('WHATSAPP_TO'),
    );
  }

  isEmailConfigured(): boolean {
    return Boolean(
      this.config.get<string>('SMTP_HOST') &&
        this.config.get<string>('SMTP_USER') &&
        this.config.get<string>('SMTP_PASS') &&
        this.config.get<string>('ALERT_EMAIL'),
    );
  }

  async pingEmail(): Promise<{
    status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
    message?: string;
    from?: string;
    to?: string;
  }> {
    if (!this.isEmailConfigured()) {
      return {
        status: 'OFFLINE',
        message: 'Set SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_EMAIL in .env',
      };
    }
    const from = this.config.get<string>('SMTP_FROM') || this.config.get<string>('SMTP_USER');
    const to = this.config.get<string>('ALERT_EMAIL');
    return {
      status: 'ONLINE',
      message: 'Gmail/SMTP credentials present — send a test from Settings',
      from: from ?? undefined,
      to: to ?? undefined,
    };
  }

  async pingTelegram(): Promise<{
    status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
    message?: string;
    botUsername?: string;
  }> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      return { status: 'OFFLINE', message: 'TELEGRAM_BOT_TOKEN not set' };
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      if (!res.ok) {
        return { status: 'OFFLINE', message: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as {
        ok?: boolean;
        result?: { username?: string };
      };
      const username = json.result?.username;
      if (!this.config.get<string>('TELEGRAM_CHAT_ID')) {
        return {
          status: 'DEGRADED',
          message:
            'Bot OK — set TELEGRAM_CHAT_ID (message the bot, then call discover-chat)',
          botUsername: username,
        };
      }
      return { status: 'ONLINE', botUsername: username };
    } catch (err) {
      return {
        status: 'OFFLINE',
        message: err instanceof Error ? err.message : 'unreachable',
      };
    }
  }

  async pingWhatsApp(): Promise<{
    status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
    message?: string;
    provider?: string;
  }> {
    const provider = (this.config.get<string>('WHATSAPP_PROVIDER') || 'meta').toLowerCase();
    if (!this.isWhatsAppConfigured()) {
      return {
        status: 'OFFLINE',
        message:
          provider === 'twilio'
            ? 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, WHATSAPP_TO'
            : 'Set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TO (Meta Cloud API)',
        provider,
      };
    }
    if (provider === 'twilio') {
      return {
        status: 'ONLINE',
        message: 'Twilio credentials present — send a test from Settings',
        provider: 'twilio',
      };
    }
    try {
      const token = this.config.get<string>('WHATSAPP_TOKEN')!;
      const phoneId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')!;
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${phoneId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const body = await res.text();
        return {
          status: 'OFFLINE',
          message: `Meta HTTP ${res.status}: ${body.slice(0, 80)}`,
          provider: 'meta',
        };
      }
      return {
        status: 'ONLINE',
        message: 'Meta Cloud API reachable',
        provider: 'meta',
      };
    } catch (err) {
      return {
        status: 'OFFLINE',
        message: err instanceof Error ? err.message : 'unreachable',
        provider: 'meta',
      };
    }
  }

  /**
   * After you message the bot, this reads Telegram getUpdates and returns chat ids.
   */
  async discoverChatIds(): Promise<{
    chats: Array<{ chatId: string; type: string; title?: string; username?: string }>;
    hint: string;
  }> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      return {
        chats: [],
        hint: 'Set TELEGRAM_BOT_TOKEN in .env first (from @BotFather).',
      };
    }
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?limit=20`,
    );
    if (!res.ok) {
      throw new Error(`Telegram getUpdates HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: Array<{
        message?: {
          chat?: {
            id: number;
            type: string;
            title?: string;
            username?: string;
            first_name?: string;
          };
        };
      }>;
    };
    const map = new Map<
      string,
      { chatId: string; type: string; title?: string; username?: string }
    >();
    for (const u of json.result ?? []) {
      const chat = u.message?.chat;
      if (!chat) continue;
      map.set(String(chat.id), {
        chatId: String(chat.id),
        type: chat.type,
        title: chat.title ?? chat.first_name,
        username: chat.username,
      });
    }
    const chats = [...map.values()];
    return {
      chats,
      hint:
        chats.length === 0
          ? 'Open Telegram, message your bot once, then call this again.'
          : 'Copy a chatId into TELEGRAM_CHAT_ID in .env and restart the API.',
    };
  }

  formatBuySetup(payload: {
    symbol: string;
    mint?: string;
    pairAddress?: string | null;
    safety: number;
    signal: number;
    axiom: number | null;
    entryMin: number;
    entryMax: number;
    stopLoss: number;
    tp1Pct: number;
    tp2Pct: number;
    remainingPct: number;
    riskReward: number;
    reason: string;
  }): { title: string; body: string } {
    const chartUrl = payload.mint
      ? dexScreenerSolanaUrl(payload.mint, payload.pairAddress)
      : null;
    const body = [
      'BUY SETUP',
      '',
      `Token: $${payload.symbol}`,
      payload.mint ? `Mint: ${payload.mint}` : null,
      chartUrl ? `DexScreener: ${chartUrl}` : null,
      '',
      `Safety: ${Math.round(payload.safety)}/100`,
      `Signal: ${Math.round(payload.signal)}/100`,
      '',
      `Entry: ${payload.entryMin}–${payload.entryMax}`,
      `SL: ${payload.stopLoss}`,
      `TP1: +${payload.tp1Pct}%`,
      `TP2: +${payload.tp2Pct}%`,
      `Remaining: ${payload.remainingPct}% trailing stop`,
      '',
      `Risk/Reward: 1:${payload.riskReward.toFixed(1)}`,
      '',
      `Reason: ${payload.reason}`,
      '',
      DISCLAIMER,
    ]
      .filter((line) => line !== null)
      .join('\n');
    return { title: `BUY SETUP $${payload.symbol}`, body };
  }

  formatFxSetup(payload: {
    symbol: string;
    side: 'BUY' | 'SELL';
    mid: number;
    buyPct: number;
    sellPct: number;
    setupQuality: number;
    zoneLow?: number | null;
    zoneHigh?: number | null;
    stopLoss?: number | null;
    takeProfit1?: number | null;
    takeProfit2?: number | null;
    rsi?: number | null;
    reason: string;
  }): { title: string; body: string } {
    const body = [
      `FX ${payload.side} ${payload.symbol}`,
      '',
      `Price: ${payload.mid}`,
      `BUY ${payload.buyPct}% · SELL ${payload.sellPct}%`,
      `Setup quality: ${payload.setupQuality}/100 (not a win probability)`,
      payload.rsi != null ? `RSI: ${Math.round(payload.rsi)}` : null,
      '',
      payload.zoneLow != null && payload.zoneHigh != null
        ? `Entry zone: ${payload.zoneLow}–${payload.zoneHigh}`
        : null,
      payload.stopLoss != null ? `SL: ${payload.stopLoss}` : null,
      payload.takeProfit1 != null ? `TP1: ${payload.takeProfit1}` : null,
      payload.takeProfit2 != null ? `TP2: ${payload.takeProfit2}` : null,
      '',
      `Why: ${payload.reason}`,
      '',
      'Open FX BOT → tap BUY or SELL → live recheck before any paper fill. Not automatic live trading.',
      '',
      'Forex trading involves substantial risk of loss. This is not financial advice.',
    ]
      .filter((line) => line !== null)
      .join('\n');
    return { title: `FX ${payload.side} ${payload.symbol}`, body };
  }

  formatFxExit(payload: {
    kind: 'TP1' | 'TP2' | 'STOP_LOSS' | 'TRAIL_OR_BE' | 'MANUAL_CLOSE';
    symbol: string;
    detail?: string;
  }): { title: string; body: string } {
    const map: Record<string, string> = {
      TP1: `FX TP1 HIT ${payload.symbol}\n\nPartial take-profit filled. Stop moved toward breakeven.`,
      TP2: `FX TP2 HIT ${payload.symbol}\n\nSecond target filled. Trailing stop on the remainder.`,
      STOP_LOSS: `FX STOP LOSS ${payload.symbol}\n\nPosition closed at stop.`,
      TRAIL_OR_BE: `FX EXIT ${payload.symbol}\n\nTrailing stop or breakeven hit.`,
      MANUAL_CLOSE: `FX CLOSED ${payload.symbol}\n\nPosition closed.`,
    };
    return {
      title: `FX ${payload.kind} ${payload.symbol}`,
      body: `${map[payload.kind] ?? `FX ${payload.kind} ${payload.symbol}`}${
        payload.detail ? `\n\n${payload.detail}` : ''
      }\n\nForex trading involves substantial risk of loss. This is not financial advice.`,
    };
  }

  formatPaperExit(payload: {
    kind: 'TP1' | 'TP2' | 'TRAILING_STOP' | 'STOP_LOSS';
    symbol: string;
    detail?: string;
  }): { title: string; body: string } {
    const map = {
      TP1: `TP1 HIT\n\nToken: $${payload.symbol}\n\nProfit target: +30%\nAction: SELL 30%`,
      TP2: `TP2 HIT\n\nToken: $${payload.symbol}\n\nProfit target: +60%\nAction: SELL 40%\n\nRemaining: 30%\nTrailing stop active.`,
      TRAILING_STOP: `TRAILING STOP HIT\n\nToken: $${payload.symbol}\n\nRemaining position closed.`,
      STOP_LOSS: `STOP LOSS\n\nToken: $${payload.symbol}\n\nPosition closed.`,
    } as const;
    return {
      title: `${payload.kind} $${payload.symbol}`,
      body: `${map[payload.kind]}${payload.detail ? `\n\n${payload.detail}` : ''}\n\n${DISCLAIMER}`,
    };
  }

  async notify(title: string, body: string): Promise<AppNotification> {
    const flags = await this.resolveChannelFlags();
    const configured = this.configuredChannels();
    const channels = activeAlertChannels(flags, configured);
    const redis = await this.redis.ping();
    const useQueue = redis.status === 'ONLINE';

    const baseId = `ntf_${Date.now()}_${this.items.length}`;
    let primary: AppNotification = {
      id: baseId,
      channel: 'in_app',
      title,
      body,
      sentAt: new Date().toISOString(),
      delivered: true,
    };

    const deliver = async (
      channel: 'telegram' | 'whatsapp' | 'email',
      send: () => Promise<void>,
    ) => {
      const item: AppNotification = {
        id: `${baseId}_${channel}`,
        channel,
        title,
        body,
        sentAt: new Date().toISOString(),
        delivered: false,
      };
      try {
        await send();
        item.delivered = true;
      } catch (err) {
        item.error = err instanceof Error ? err.message : `${channel} send failed`;
        this.logger.warn(`${channel} notify failed: ${item.error}`);
        if (useQueue) {
          try {
            await this.queue.add(
              channel,
              { title, body, notificationId: item.id, channel },
              { jobId: item.id },
            );
            item.queued = true;
            this.logger.warn(`${channel} queued for retry after direct send failed`);
          } catch (queueErr) {
            this.logger.warn(
              `${channel} queue retry failed: ${
                queueErr instanceof Error ? queueErr.message : 'queue error'
              }`,
            );
          }
        }
      }
      this.items.unshift(item);
      primary = item;
    };

    if (channels.includes('telegram')) {
      await deliver('telegram', () => this.sendTelegram(`${title}\n\n${body}`));
    }
    if (channels.includes('whatsapp')) {
      await deliver('whatsapp', () => this.sendWhatsApp(`${title}\n\n${body}`));
    }
    if (channels.includes('email')) {
      await deliver('email', () => this.sendEmail(title, body));
    }

    if (primary.channel === 'in_app') {
      this.items.unshift(primary);
      this.logger.warn(
        `Alert "${title}" stayed in-app only (telegram=${configured.telegram}/${flags.telegramEnabled} email=${configured.email}/${flags.emailEnabled})`,
      );
    } else {
      this.logger.log(`Alert "${title}" → ${channels.join(', ')}`);
    }
    if (this.items.length > 200) this.items.length = 200;
    return primary;
  }

  /** Called by BullMQ worker after dequeue. */
  async deliverNotificationJob(data: NotificationJobData): Promise<void> {
    if (data.channel === 'email') {
      await this.sendEmail(data.title, data.body);
    } else {
      const text = `${data.title}\n\n${data.body}`;
      if (data.channel === 'whatsapp') {
        await this.sendWhatsApp(text);
      } else {
        await this.sendTelegram(text);
      }
    }
    const existing = this.items.find((i) => i.id === data.notificationId);
    if (existing) {
      existing.delivered = true;
      existing.queued = false;
      existing.error = undefined;
    }
  }

  /** @deprecated use deliverNotificationJob */
  async deliverTelegramJob(data: NotificationJobData): Promise<void> {
    return this.deliverNotificationJob(data);
  }

  async notifyBuySetup(payload: Parameters<NotificationsService['formatBuySetup']>[0]) {
    const flags = await this.resolveChannelFlags();
    if (!flags.notifyBuySetups) {
      this.logger.warn(`BUY SETUP $${payload.symbol} skipped — notifyBuySetups is off`);
      return null;
    }
    const key = (payload.mint || payload.symbol).toLowerCase();
    const now = Date.now();
    if (shouldSkipBuyAlert(this.buyAlertSentAt.get(key), now)) {
      this.logger.log(`BUY SETUP $${payload.symbol} skipped — already alerted recently`);
      return null;
    }
    const msg = this.formatBuySetup(payload);
    const result = await this.notify(msg.title, msg.body);
    this.buyAlertSentAt.set(key, now);
    return result;
  }

  async notifyFxSetup(payload: Parameters<NotificationsService['formatFxSetup']>[0]) {
    if (this.settings.getSettings().notifyFxSetups === false) {
      this.logger.warn(`FX ${payload.side} ${payload.symbol} skipped — notifyFxSetups is off`);
      return null;
    }
    const key = `fx:${payload.symbol}:${payload.side}`;
    const now = Date.now();
    if (shouldSkipBuyAlert(this.fxAlertSentAt.get(key), now)) {
      this.logger.log(`FX ${payload.side} ${payload.symbol} skipped — already alerted recently`);
      return null;
    }
    const msg = this.formatFxSetup(payload);
    const result = await this.notify(msg.title, msg.body);
    this.fxAlertSentAt.set(key, now);
    return result;
  }

  async notifyFxExit(payload: Parameters<NotificationsService['formatFxExit']>[0]) {
    if (!this.settings.getSettings().notifyPaperExits) return null;
    const msg = this.formatFxExit(payload);
    return this.notify(msg.title, msg.body);
  }

  async notifyPaperExit(
    payload: Parameters<NotificationsService['formatPaperExit']>[0],
  ) {
    if (!this.settings.getSettings().notifyPaperExits) return null;
    const msg = this.formatPaperExit(payload);
    return this.notify(msg.title, msg.body);
  }

  private configuredChannels() {
    return {
      telegram: this.isTelegramConfigured(),
      email: this.isEmailConfigured(),
      whatsapp: this.isWhatsAppConfigured(),
    };
  }

  private async healChannelDefaultsOnce(): Promise<void> {
    if (this.channelsHealed) return;
    const patch = healPatchForConfigured(this.configuredChannels());
    if (Object.keys(patch).length) {
      this.settings.updateSettings(patch);
    }
    if (!isDbConnected()) return;
    try {
      const result = await UserSettings.updateMany(
        { alertChannelsHealed: { $ne: true } },
        { $set: { ...patch, alertChannelsHealed: true } },
      );
      this.channelsHealed = true;
      if (result.modifiedCount > 0) {
        this.logger.log(
          `Enabled saved alert channels for ${result.modifiedCount} user(s) (Telegram/Gmail were off by default)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Alert-channel heal skipped: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  }

  private async resolveChannelFlags(): Promise<ChannelFlags> {
    await this.healChannelDefaultsOnce();
    const memory: ChannelFlags = {
      notifyBuySetups: this.settings.getSettings().notifyBuySetups,
      telegramEnabled: this.settings.getSettings().telegramEnabled,
      emailEnabled: this.settings.getSettings().emailEnabled,
      whatsappEnabled: this.settings.getSettings().whatsappEnabled,
    };
    let persisted: ChannelFlags | null = null;
    if (isDbConnected()) {
      try {
        const doc = await UserSettings.findOne().sort({ updatedAt: -1 }).lean();
        if (doc) {
          persisted = {
            notifyBuySetups: doc.notifyBuySetups !== false,
            telegramEnabled: Boolean(doc.telegramEnabled),
            emailEnabled: Boolean(doc.emailEnabled),
            whatsappEnabled: Boolean(doc.whatsappEnabled),
          };
        }
      } catch (err) {
        this.logger.warn(
          `Could not load saved alert settings: ${
            err instanceof Error ? err.message : 'error'
          }`,
        );
      }
    }
    const flags = mergeChannelFlags({
      memory,
      persisted,
      configured: this.configuredChannels(),
    });
    this.settings.updateSettings({
      notifyBuySetups: flags.notifyBuySetups,
      telegramEnabled: flags.telegramEnabled,
      emailEnabled: flags.emailEnabled,
      whatsappEnabled: flags.whatsappEnabled,
    });
    return flags;
  }

  private async sendTelegram(text: string): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
    if (!token || !chatId) {
      throw new Error('Telegram not configured');
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram HTTP ${res.status}: ${body.slice(0, 120)}`);
    }
  }

  private async sendWhatsApp(text: string): Promise<void> {
    const provider = (this.config.get<string>('WHATSAPP_PROVIDER') || 'meta').toLowerCase();
    if (provider === 'twilio') {
      return this.sendWhatsAppTwilio(text);
    }
    return this.sendWhatsAppMeta(text);
  }

  private async sendWhatsAppMeta(text: string): Promise<void> {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const to = this.normalizeWhatsAppTo(this.config.get<string>('WHATSAPP_TO'));
    if (!token || !phoneId || !to) {
      throw new Error('WhatsApp Meta not configured');
    }

    const template = this.config.get<string>('WHATSAPP_TEMPLATE_NAME');
    const payload = template
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: template,
            language: {
              code: this.config.get<string>('WHATSAPP_TEMPLATE_LANG') || 'en_US',
            },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: text.slice(0, 1000) }],
              },
            ],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text.slice(0, 4000) },
        };

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WhatsApp Meta HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
  }

  private async sendWhatsAppTwilio(text: string): Promise<void> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const auth = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_WHATSAPP_FROM');
    const toRaw = this.config.get<string>('WHATSAPP_TO');
    if (!sid || !auth || !from || !toRaw) {
      throw new Error('WhatsApp Twilio not configured');
    }
    const to = toRaw.startsWith('whatsapp:')
      ? toRaw
      : `whatsapp:+${this.normalizeWhatsAppTo(toRaw)}`;
    const fromFormatted = from.startsWith('whatsapp:')
      ? from
      : `whatsapp:${from}`;

    const body = new URLSearchParams({
      From: fromFormatted,
      To: to,
      Body: text.slice(0, 1500),
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`WhatsApp Twilio HTTP ${res.status}: ${errBody.slice(0, 160)}`);
    }
  }

  /** Digits only country code + number, e.g. 2348012345678 */
  private normalizeWhatsAppTo(raw?: string | null): string {
    if (!raw) return '';
    return raw.replace(/[^\d]/g, '');
  }

  private getSmtpTransport() {
    const host = this.config.get<string>('SMTP_HOST')!;
    const port = Number(this.config.get<string>('SMTP_PORT') || 587);
    const user = this.config.get<string>('SMTP_USER')!;
    const pass = this.config.get<string>('SMTP_PASS')!;
    const secure =
      this.config.get<string>('SMTP_SECURE') === 'true' || port === 465;
    const options: SMTPTransport.Options = {
      host,
      port,
      secure,
      auth: { user, pass },
    };
    return nodemailer.createTransport(options);
  }

  private async sendEmail(subject: string, text: string): Promise<void> {
    if (!this.isEmailConfigured()) {
      throw new Error('Email not configured');
    }
    const from =
      this.config.get<string>('SMTP_FROM') ||
      this.config.get<string>('SMTP_USER')!;
    const to = this.config.get<string>('ALERT_EMAIL')!;
    const transport = this.getSmtpTransport();
    await transport.sendMail({
      from: `"Memecoinbot" <${from}>`,
      to,
      subject: subject.slice(0, 200),
      text: text.slice(0, 8000),
    });
  }
}
