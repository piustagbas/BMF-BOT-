import { Injectable } from '@nestjs/common';
import { HealthStatus, type HealthResponse } from '@memecoinbot/shared';
import {
  pingAxiom,
  pingDexScreener,
  pingGeckoTerminal,
  pingJupiter,
  pingSolanaRpc,
  pingTokenSecurity,
} from '@memecoinbot/data-providers';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const app = this.settings.getSettings();

    const [dbOk, dexscreener, jupiter, solana, axiom, tokenSecurity, ohlcv, telegram, redis] =
      await Promise.all([
        this.prisma.tryConnect(),
        pingDexScreener(),
        pingJupiter(),
        pingSolanaRpc(),
        pingAxiom(),
        pingTokenSecurity(),
        pingGeckoTerminal(),
        this.notifications.pingTelegram(),
        this.redis.ping(),
      ]);

    const sources: HealthResponse['sources'] = {
      api: { status: HealthStatus.ONLINE },
      database: dbOk
        ? { status: HealthStatus.ONLINE }
        : {
            status: HealthStatus.OFFLINE,
            message: 'Cannot connect — live market APIs still work without DB',
          },
      redis,
      dexscreener,
      jupiter,
      solana_rpc: solana,
      token_security: tokenSecurity,
      ohlcv,
      notifications: telegram,
      axiom,
    };

    const statuses = Object.values(sources).map((s) => s.status);
    let status: HealthResponse['status'] = HealthStatus.ONLINE;
    if (statuses.includes(HealthStatus.DEGRADED) || statuses.includes(HealthStatus.OFFLINE)) {
      status = HealthStatus.DEGRADED;
    }
    // Scanner can run on GeckoTerminal alone; only go fully OFFLINE if both market + RPC are down.
    if (
      ohlcv.status === HealthStatus.OFFLINE &&
      solana.status === HealthStatus.OFFLINE
    ) {
      status = HealthStatus.OFFLINE;
    }

    return {
      status,
      version: '0.1.0',
      tradingMode: app.tradingMode,
      autoTradingEnabled: app.autoTradingEnabled,
      killSwitch: app.killSwitch,
      timestamp: new Date().toISOString(),
      sources,
    };
  }
}
