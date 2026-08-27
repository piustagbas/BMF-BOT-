import mongoose from 'mongoose';

export async function connectDB(uri?: string): Promise<boolean> {
  const mongoURI =
    uri ||
    process.env.MONGODB_URI ||
    'mongodb://127.0.0.1:27017/memecoinbot';
  try {
    if (mongoose.connection.readyState === 1) return true;
    await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 8000 });
    return true;
  } catch (err) {
    console.error(
      'MongoDB connection failed:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
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
