import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

export type PositionStatus = 'OPEN' | 'CLOSED';

export interface IUserPosition extends Document {
  userId: Types.ObjectId;
  wallet: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  status: PositionStatus;
  qty: number;
  avgEntry: number;
  sizeUsd: number;
  realizedPnlUsd: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  lastPrice: number | null;
  lastTxSignature: string | null;
  openedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserPositionSchema = new Schema<IUserPosition>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    wallet: { type: String, required: true },
    tokenAddress: { type: String, required: true },
    symbol: { type: String, required: true },
    name: { type: String, default: '' },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', index: true },
    qty: { type: Number, default: 0 },
    avgEntry: { type: Number, default: 0 },
    sizeUsd: { type: Number, default: 0 },
    realizedPnlUsd: { type: Number, default: 0 },
    takeProfitPct: { type: Number, default: null },
    stopLossPct: { type: Number, default: null },
    takeProfitPrice: { type: Number, default: null },
    stopLossPrice: { type: Number, default: null },
    lastPrice: { type: Number, default: null },
    lastTxSignature: { type: String, default: null },
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

UserPositionSchema.index({ userId: 1, status: 1 });
UserPositionSchema.index({ userId: 1, tokenAddress: 1, wallet: 1, status: 1 });
UserPositionSchema.index({ status: 1, takeProfitPct: 1 });
UserPositionSchema.index({ status: 1, stopLossPct: 1 });

export const UserPosition: Model<IUserPosition> =
  mongoose.models.UserPosition ||
  mongoose.model<IUserPosition>('UserPosition', UserPositionSchema);
