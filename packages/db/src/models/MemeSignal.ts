import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IMemeSignal extends Document {
  token: string;
  symbol: string;
  smartMoneyScore: number;
  overallScore: number;
  numberOfSmartWallets: number;
  tierAWallets: number;
  tierBWallets: number;
  liquidityScore: number;
  volumeScore: number;
  holderScore: number;
  technicalScore: number;
  riskScore: number;
  signal: string;
  reason: string;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MemeSignalSchema = new Schema<IMemeSignal>(
  {
    token: { type: String, required: true, index: true },
    symbol: { type: String, default: '' },
    smartMoneyScore: { type: Number, default: 0 },
    overallScore: { type: Number, default: 0, index: true },
    numberOfSmartWallets: { type: Number, default: 0 },
    tierAWallets: { type: Number, default: 0 },
    tierBWallets: { type: Number, default: 0 },
    liquidityScore: { type: Number, default: 0 },
    volumeScore: { type: Number, default: 0 },
    holderScore: { type: Number, default: 0 },
    technicalScore: { type: Number, default: 0 },
    riskScore: { type: Number, default: 0 },
    signal: { type: String, default: 'AVOID' },
    reason: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

export const MemeSignal: Model<IMemeSignal> =
  mongoose.models.MemeSignal || mongoose.model<IMemeSignal>('MemeSignal', MemeSignalSchema);
