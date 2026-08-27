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

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const uri = this.config.get<string>('MONGODB_URI');
    const ok = await connectDB(uri);
    if (ok) {
      this.logger.log('MongoDB connected');
    } else {
      this.logger.warn(
        'MongoDB unavailable — auth/watchlist persistence offline; live market APIs still work',
      );
    }
  }

  async tryConnect(): Promise<boolean> {
    if (isDbConnected()) return true;
    const uri = this.config.get<string>('MONGODB_URI');
    return connectDB(uri);
  }

  isConnected(): boolean {
    return isDbConnected();
  }

  async onModuleDestroy() {
    await disconnectDB();
  }
}
