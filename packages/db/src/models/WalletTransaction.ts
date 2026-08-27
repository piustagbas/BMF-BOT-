import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IWalletTransaction extends Document {
  wallet: string;
  token: string;
  symbol: string | null;
  transactionHash: string;
  transactionType: 'buy' | 'sell';
  amount: number;
  usdValue: number;
  price: number;
  marketCap: number | null;
  liquidity: number | null;
  timestamp: Date;
  provider: string;
  createdAt: Date;
  updatedAt: Date;
}

const WalletTransactionSchema = new Schema<IWalletTransaction>(
  {
    wallet: { type: String, required: true, index: true },
    token: { type: String, required: true, index: true },
    symbol: { type: String, default: null },
    transactionHash: { type: String, required: true },
    transactionType: { type: String, enum: ['buy', 'sell'], required: true },
    amount: { type: Number, default: 0 },
    usdValue: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    marketCap: { type: Number, default: null },
    liquidity: { type: Number, default: null },
    timestamp: { type: Date, required: true, index: true },
    provider: { type: String, default: 'geckoterminal' },
  },
  { timestamps: true },
);

WalletTransactionSchema.index(
  { transactionHash: 1, wallet: 1, transactionType: 1, token: 1 },
  { unique: true },
);

export const WalletTransaction: Model<IWalletTransaction> =
  mongoose.models.WalletTransaction ||
  mongoose.model<IWalletTransaction>('WalletTransaction', WalletTransactionSchema);
