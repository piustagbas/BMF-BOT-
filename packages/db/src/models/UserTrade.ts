import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

export type TradeSide = 'BUY' | 'SELL';

export type TradeStatus =
  | 'PREPARING'
  | 'AWAITING_WALLET'
  | 'SUBMITTED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'REJECTED';

export interface IUserTrade extends Document {
  userId: Types.ObjectId;
  wallet: string;
  tokenAddress: string;
  contractAddress: string;
  symbol: string;
  name: string;
  side: TradeSide;
  status: TradeStatus;
  amountUsd: number;
  tokenQuantity: number;
  entryPrice: number | null;
  exitPrice: number | null;
  platformFeeUsd: number;
  networkFeeUsd: number;
  slippageBps: number;
  priceImpactPct: number | null;
  minReceived: string | null;
  estimatedReceived: string | null;
  txSignature: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  dexId: string | null;
  pairAddress: string | null;
  network: string;
  router: string;
  confirmedAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserTradeSchema = new Schema<IUserTrade>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    wallet: { type: String, required: true, index: true },
    tokenAddress: { type: String, required: true, index: true },
    contractAddress: { type: String, required: true },
    symbol: { type: String, required: true },
    name: { type: String, default: '' },
    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    status: {
      type: String,
      enum: [
        'PREPARING',
        'AWAITING_WALLET',
        'SUBMITTED',
        'PENDING',
        'CONFIRMED',
        'FAILED',
        'REJECTED',
      ],
      default: 'PREPARING',
      index: true,
    },
    amountUsd: { type: Number, required: true },
    tokenQuantity: { type: Number, default: 0 },
    entryPrice: { type: Number, default: null },
    exitPrice: { type: Number, default: null },
    platformFeeUsd: { type: Number, default: 0 },
    networkFeeUsd: { type: Number, default: 0 },
    slippageBps: { type: Number, default: 50 },
    priceImpactPct: { type: Number, default: null },
    minReceived: { type: String, default: null },
    estimatedReceived: { type: String, default: null },
    txSignature: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    takeProfitPct: { type: Number, default: null },
    stopLossPct: { type: Number, default: null },
    dexId: { type: String, default: null },
    pairAddress: { type: String, default: null },
    network: { type: String, default: 'solana' },
    router: { type: String, default: 'jupiter' },
    confirmedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

UserTradeSchema.index({ userId: 1, createdAt: -1 });
UserTradeSchema.index({ userId: 1, status: 1, createdAt: -1 });
UserTradeSchema.index({ txSignature: 1 }, { unique: true, sparse: true });
UserTradeSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
UserTradeSchema.index({ tokenAddress: 1, createdAt: -1 });

export const UserTrade: Model<IUserTrade> =
  mongoose.models.UserTrade || mongoose.model<IUserTrade>('UserTrade', UserTradeSchema);
