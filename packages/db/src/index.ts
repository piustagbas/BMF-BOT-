import mongoose from 'mongoose';

const DEFAULT_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/memecoinbot';

export async function connectDB(uri?: string, opts?: { retries?: number }): Promise<boolean> {
  const mongoURI = uri || DEFAULT_URI;
  const retries = opts?.retries ?? 3;
  if (mongoose.connection.readyState === 1) return true;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close().catch(() => undefined);
      }
      await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 12_000,
        connectTimeoutMS: 12_000,
        maxPoolSize: 10,
        bufferCommands: false,
      });
      return true;
    } catch (err) {
      console.error(
        `MongoDB connection failed (attempt ${attempt}/${retries}):`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  return false;
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export { mongoose };
export { User, type IUser } from './models/User';
export { WatchlistItem, type IWatchlistItem } from './models/WatchlistItem';
export { UserSettings, type IUserSettings } from './models/UserSettings';
export { DiscoveredWallet, type IDiscoveredWallet } from './models/DiscoveredWallet';
export { WalletTransaction, type IWalletTransaction } from './models/WalletTransaction';
export { TrackedToken, type ITrackedToken } from './models/TrackedToken';
export { MemeSignal, type IMemeSignal } from './models/MemeSignal';
export {
  ConnectedWallet,
  type IConnectedWallet,
  type WalletProvider,
} from './models/ConnectedWallet';
export {
  UserTrade,
  type IUserTrade,
  type TradeSide,
  type TradeStatus,
} from './models/UserTrade';
export {
  UserPosition,
  type IUserPosition,
  type PositionStatus,
} from './models/UserPosition';
export {
  AppNotification,
  type IAppNotification,
  type INotificationAction,
  type NotificationType,
} from './models/AppNotification';
export {
  TpslOrder,
  type ITpslOrder,
  type TpslKind,
  type TpslMode,
  type TpslStatus,
} from './models/TpslOrder';
export {
  FootballFixtureRecord,
  FootballPredictionRecord,
  FootballBacktestRecord,
  FootballSyncLog,
  type IFootballFixtureRecord,
  type IFootballPredictionRecord,
  type IFootballBacktestRecord,
  type IFootballSyncLog,
} from './models/FootballRecords';
export {
  FootballEntity,
  type IFootballEntity,
  type FootballEntityType,
} from './models/FootballEntity';
