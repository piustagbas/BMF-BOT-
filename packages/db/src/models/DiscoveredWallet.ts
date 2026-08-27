import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type WalletTierDoc = 'A' | 'B' | 'C' | 'D';

export interface IDiscoveredWallet extends Document {
  address: string;
  label: string;
  smartScore: number;
  tier: WalletTierDoc;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  realizedPnl: number;
  unrealizedPnl: number;
  roi: number;
  averageHoldTimeMs: number;
  earlyEntryScore: number;
  riskScore: number;
  firstSeen: Date | null;
  lastActive: Date | null;
  confidenceScore: number;
  tokensTraded: number;
  profitableCalls: number;
  failedCalls: number;
  consistency: number;
  luckScore: number;
  excluded: boolean;
  excludeReasons: string[];
  influence: number;
  windows: {
    last24h: number;
    last7d: number;
    last30d: number;
    allTime: number;
  };
  origin: 'DISCOVERED';
  createdAt: Date;
  updatedAt: Date;
}

const DiscoveredWalletSchema = new Schema<IDiscoveredWallet>(
  {
    address: { type: String, required: true, unique: true, index: true },
    label: { type: String, default: '' },
    smartScore: { type: Number, default: 0, index: true },
    tier: { type: String, enum: ['A', 'B', 'C', 'D'], default: 'C', index: true },
    totalTrades: { type: Number, default: 0 },
    winningTrades: { type: Number, default: 0 },
    losingTrades: { type: Number, default: 0 },
    winRate: { type: Number, default: 0 },
    realizedPnl: { type: Number, default: 0 },
    unrealizedPnl: { type: Number, default: 0 },
    roi: { type: Number, default: 0 },
    averageHoldTimeMs: { type: Number, default: 0 },
    earlyEntryScore: { type: Number, default: 0 },
    riskScore: { type: Number, default: 0 },
    firstSeen: { type: Date, default: null },
    lastActive: { type: Date, default: null },
    confidenceScore: { type: Number, default: 0 },
    tokensTraded: { type: Number, default: 0 },
    profitableCalls: { type: Number, default: 0 },
    failedCalls: { type: Number, default: 0 },
    consistency: { type: Number, default: 0 },
    luckScore: { type: Number, default: 0 },
    excluded: { type: Boolean, default: false },
    excludeReasons: { type: [String], default: [] },
    influence: { type: Number, default: 0 },
    windows: {
      last24h: { type: Number, default: 50 },
      last7d: { type: Number, default: 50 },
      last30d: { type: Number, default: 50 },
      allTime: { type: Number, default: 50 },
    },
    origin: { type: String, default: 'DISCOVERED' },
  },
  { timestamps: true },
);

export const DiscoveredWallet: Model<IDiscoveredWallet> =
  mongoose.models.DiscoveredWallet ||
  mongoose.model<IDiscoveredWallet>('DiscoveredWallet', DiscoveredWalletSchema);
