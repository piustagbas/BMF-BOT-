import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface ITrackedToken extends Document {
  tokenAddress: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  liquidity: number | null;
  volume: number | null;
  holders: number | null;
  buyCount: number | null;
  sellCount: number | null;
  riskScore: number | null;
  pairAddress: string | null;
  lastTradesAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TrackedTokenSchema = new Schema<ITrackedToken>(
  {
    tokenAddress: { type: String, required: true, unique: true, index: true },
    symbol: { type: String, default: '' },
    name: { type: String, default: '' },
    marketCap: { type: Number, default: null },
    liquidity: { type: Number, default: null },
    volume: { type: Number, default: null },
    holders: { type: Number, default: null },
    buyCount: { type: Number, default: null },
    sellCount: { type: Number, default: null },
    riskScore: { type: Number, default: null },
    pairAddress: { type: String, default: null },
    lastTradesAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const TrackedToken: Model<ITrackedToken> =
  mongoose.models.TrackedToken ||
  mongoose.model<ITrackedToken>('TrackedToken', TrackedTokenSchema);
