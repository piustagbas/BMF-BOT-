import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { HealthModule } from './health/health.module';
import { StatusModule } from './status/status.module';
import { TokensModule } from './tokens/tokens.module';
import { SafetyModule } from './safety/safety.module';
import { SignalsModule } from './signals/signals.module';
import { PaperModule } from './paper/paper.module';
import { BacktestsModule } from './backtests/backtests.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TradingModule } from './trading/trading.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { BetBotModule } from './bet-bot/bet-bot.module';
import { ForexBotModule } from './forex-bot/forex-bot.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SmartMoneyModule } from './smart-money/smart-money.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(__dirname, '../../../.env'), // monorepo root (from dist/)
        join(__dirname, '../../.env'), // apps/api/.env
        join(process.cwd(), '.env'),
        join(process.cwd(), '../../.env'),
      ],
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    SettingsModule,
    NotificationsModule,
    HealthModule,
    StatusModule,
    SafetyModule,
    TokensModule,
    SignalsModule,
    PaperModule,
    BacktestsModule,
    TradingModule,
    WatchlistModule,
    BetBotModule,
    ForexBotModule,
    SmartMoneyModule,
  ],
})
export class AppModule {}
