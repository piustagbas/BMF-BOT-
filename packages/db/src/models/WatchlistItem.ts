import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

export interface IWatchlistItem extends Document {
  userId: Types.ObjectId;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  notes: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  priceChange24h: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const WatchlistSchema = new Schema<IWatchlistItem>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    address: { type: String, required: true },
    symbol: { type: String, required: true },
    name: { type: String, required: true },
    imageUrl: { type: String, default: null },
    notes: { type: String, default: null },
    priceUsd: { type: Number, default: null },
    liquidityUsd: { type: Number, default: null },
    priceChange24h: { type: Number, default: null },
  },
  { timestamps: true },
);

WatchlistSchema.index({ userId: 1, address: 1 }, { unique: true });

export const WatchlistItem: Model<IWatchlistItem> =
  mongoose.models.WatchlistItem ||
  mongoose.model<IWatchlistItem>('WatchlistItem', WatchlistSchema);
