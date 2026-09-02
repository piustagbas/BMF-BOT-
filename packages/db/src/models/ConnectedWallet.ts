import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

export type WalletProvider = 'phantom' | 'solflare' | 'manual';

export interface IConnectedWallet extends Document {
  userId: Types.ObjectId;
  address: string;
  provider: WalletProvider;
  label: string | null;
  lastBalanceSol: number | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ConnectedWalletSchema = new Schema<IConnectedWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    address: { type: String, required: true },
    provider: {
      type: String,
      enum: ['phantom', 'solflare', 'manual'],
      default: 'manual',
    },
    label: { type: String, default: null },
    lastBalanceSol: { type: Number, default: null },
    connectedAt: { type: Date, default: Date.now },
    disconnectedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ConnectedWalletSchema.index({ userId: 1, address: 1 }, { unique: true });
ConnectedWalletSchema.index({ userId: 1, disconnectedAt: 1 });

export const ConnectedWallet: Model<IConnectedWallet> =
  mongoose.models.ConnectedWallet ||
  mongoose.model<IConnectedWallet>('ConnectedWallet', ConnectedWalletSchema);
