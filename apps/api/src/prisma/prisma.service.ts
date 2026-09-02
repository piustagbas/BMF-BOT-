import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connectDB, disconnectDB, isDbConnected } from '@memecoinbot/db';

/**
 * Mongo connection wrapper (replaces PrismaService).
 * Market-data writes are best-effort / optional; auth + watchlist + settings use models directly.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.tryConnect();
    this.reconnectTimer = setInterval(() => {
      if (!isDbConnected()) {
        void this.tryConnect();
      }
    }, 20_000);
  }

  async tryConnect(): Promise<boolean> {
    if (isDbConnected()) return true;
    const uri = this.config.get<string>('MONGODB_URI');
    const ok = await connectDB(uri, { retries: 3 });
    if (ok) {
      this.logger.log('MongoDB connected');
    } else {
      this.logger.warn(
        'MongoDB unavailable — auth/watchlist/notifications offline; live market APIs still work',
      );
    }
    return ok;
  }

  isConnected(): boolean {
    return isDbConnected();
  }

  async onModuleDestroy() {
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    await disconnectDB();
  }
}
