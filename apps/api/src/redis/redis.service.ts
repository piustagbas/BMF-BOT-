import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  getClient(): Redis {
    if (!this.client) {
      const url = this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';
      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: true,
      });
      this.client.on('error', (err) => {
        this.logger.warn(`Redis error: ${err.message}`);
      });
    }
    return this.client;
  }

  async ping(): Promise<{
    status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
    message?: string;
  }> {
    try {
      const client = this.getClient();
      if (client.status !== 'ready') {
        await client.connect().catch(() => undefined);
      }
      const pong = await client.ping();
      if (pong === 'PONG') return { status: 'ONLINE' };
      return { status: 'DEGRADED', message: `Unexpected: ${pong}` };
    } catch (err) {
      return {
        status: 'OFFLINE',
        message: err instanceof Error ? err.message : 'Redis unreachable',
      };
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => this.client?.disconnect());
      this.client = null;
    }
  }
}
