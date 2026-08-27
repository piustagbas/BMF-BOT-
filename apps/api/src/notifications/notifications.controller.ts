import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.notifications.list(limit ? Number(limit) : 50);
  }

  @Get('status')
  status() {
    return this.notifications.status();
  }

  @Get('telegram/status')
  async telegramStatus() {
    const ping = await this.notifications.pingTelegram();
    return {
      configured: this.notifications.isTelegramConfigured(),
      ...ping,
    };
  }

  @Get('telegram/discover-chat')
  discoverChat() {
    return this.notifications.discoverChatIds();
  }

  @Get('telegram/setup')
  setupHelp() {
    return {
      steps: [
        'Open Telegram and talk to @BotFather',
        'Send /newbot and follow prompts — copy the bot token',
        'Put TELEGRAM_BOT_TOKEN=<token> in Memecoinbot .env',
        'Restart the API, then message your new bot once in Telegram',
        'GET /api/notifications/telegram/discover-chat → copy chatId',
        'Put TELEGRAM_CHAT_ID=<chatId> in .env and restart API',
        'In the app: Settings → enable Telegram → Send test notification',
      ],
      redis: 'REDIS_URL=redis://127.0.0.1:6379 (alerts are queued via BullMQ when Redis is up)',
    };
  }

  @Get('whatsapp/setup')
  whatsappSetupHelp() {
    return {
      providers: ['meta', 'twilio'],
      meta: [
        'Create a Meta Business app → WhatsApp product (developers.facebook.com)',
        'Copy Temporary/permanent access token → WHATSAPP_TOKEN',
        'Copy Phone number ID → WHATSAPP_PHONE_NUMBER_ID',
        'Set WHATSAPP_TO to your number in international digits (e.g. 2348012345678)',
        'Optional: WHATSAPP_PROVIDER=meta (default)',
        'Message the WhatsApp business number once from your phone (24h window for free-form text)',
        'Or set WHATSAPP_TEMPLATE_NAME to an approved template for cold outbound',
        'Restart API → Settings → WhatsApp enabled ON → Send test notification',
      ],
      twilio: [
        'Create Twilio account → enable WhatsApp sandbox or Business sender',
        'Set WHATSAPP_PROVIDER=twilio',
        'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM=whatsapp:+14155238886',
        'WHATSAPP_TO=whatsapp:+234… (or digits only)',
        'Join sandbox if using trial (Twilio SMS instructions)',
        'Restart API → Settings → WhatsApp enabled ON → Send test',
      ],
    };
  }

  @Get('whatsapp/status')
  async whatsappStatus() {
    const ping = await this.notifications.pingWhatsApp();
    return {
      configured: this.notifications.isWhatsAppConfigured(),
      ...ping,
    };
  }

  @Get('email/setup')
  emailSetupHelp() {
    return {
      steps: [
        'Use a Gmail account with 2-Step Verification turned ON',
        'Google Account → Security → App passwords → create one for "Mail"',
        'Copy the 16-character app password (not your normal Gmail password)',
        'In Memecoinbot .env set:',
        '  SMTP_HOST=smtp.gmail.com',
        '  SMTP_PORT=587',
        '  SMTP_USER=your@gmail.com',
        '  SMTP_PASS=<16-char app password>',
        '  ALERT_EMAIL=your@gmail.com  (or another inbox to receive alerts)',
        'Optional: SMTP_FROM=your@gmail.com',
        'Restart the API',
        'In the app: Settings → Email enabled ON → Send test notification',
      ],
      note: 'Works with other SMTP providers too — change SMTP_HOST/PORT as needed.',
    };
  }

  @Get('email/status')
  async emailStatus() {
    const ping = await this.notifications.pingEmail();
    return {
      configured: this.notifications.isEmailConfigured(),
      ...ping,
    };
  }

  @Post('test')
  async test(@Body() body?: { message?: string }) {
    return this.notifications.notify(
      'TEST NOTIFICATION',
      body?.message ??
        'Memecoinbot notification channel test.\n\nThis is not a trade signal.',
    );
  }
}
