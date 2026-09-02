import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

export type TpslKind = 'TAKE_PROFIT' | 'STOP_LOSS';
export type TpslMode = 'ALERT' | 'AUTO_EXECUTE';
export type TpslStatus = 'ACTIVE' | 'TRIGGERED' | 'CANCELLED' | 'SUBMITTED' | 'CONFIRMED';

export interface ITpslOrder extends Document {
  userId: Types.ObjectId;
  positionId: Types.ObjectId;
  tradeId: Types.ObjectId | null;
  wallet: string;
  tokenAddress: string;
  symbol: string;
  kind: TpslKind;
  mode: TpslMode;
  triggerPct: number;
  triggerPrice: number;
  entryPrice: number;
  status: TpslStatus;
  triggeredAt: Date | null;
  lastAlertAt: Date | null;
  sellTradeId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const TpslOrderSchema = new Schema<ITpslOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    positionId: { type: Schema.Types.ObjectId, ref: 'UserPosition', required: true, index: true },
    tradeId: { type: Schema.Types.ObjectId, ref: 'UserTrade', default: null },
    wallet: { type: String, required: true },
    tokenAddress: { type: String, required: true, index: true },
    symbol: { type: String, required: true },
    kind: { type: String, enum: ['TAKE_PROFIT', 'STOP_LOSS'], required: true },
    mode: { type: String, enum: ['ALERT', 'AUTO_EXECUTE'], default: 'ALERT' },
    triggerPct: { type: Number, required: true },
    triggerPrice: { type: Number, required: true },
    entryPrice: { type: Number, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'TRIGGERED', 'CANCELLED', 'SUBMITTED', 'CONFIRMED'],
      default: 'ACTIVE',
      index: true,
    },
    triggeredAt: { type: Date, default: null },
    lastAlertAt: { type: Date, default: null },
    sellTradeId: { type: Schema.Types.ObjectId, ref: 'UserTrade', default: null },
  },
  { timestamps: true },
);

TpslOrderSchema.index({ status: 1, kind: 1 });
TpslOrderSchema.index({ userId: 1, tokenAddress: 1, status: 1 });
TpslOrderSchema.index({ positionId: 1, kind: 1, status: 1 });

export const TpslOrder: Model<ITpslOrder> =
  mongoose.models.TpslOrder || mongoose.model<ITpslOrder>('TpslOrder', TpslOrderSchema);
