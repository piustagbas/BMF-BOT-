import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

export interface IUserSettings extends Document {
  userId: Types.ObjectId;
  tradingMode: string;
  beginnerMode: boolean;
  notifyBuySetups: boolean;
  notifyFxSetups: boolean;
  notifyPaperExits: boolean;
  notifyRealTrades: boolean;
  telegramEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  killSwitch: boolean;
  emergencyStop: boolean;
  autoTradingEnabled: boolean;
  autoTradeMemecoins: boolean;
  autoTradeMemecoinAddresses: string[];
  autoTradeForex: boolean;
  walletPublicKey: string | null;
  trackedWallets: Array<{ address: string; label: string }>;
  maxSlippageBps: number;
  riskJson: Record<string, unknown>;
  /** Set after one-time migration that turns on env-configured alert channels. */
  alertChannelsHealed: boolean;
  notifyInApp: boolean;
  notifyPush: boolean;
  notifyBuyConfirms: boolean;
  notifySellConfirms: boolean;
  notifyTradeFailed: boolean;
  notifyTakeProfit: boolean;
  notifyStopLoss: boolean;
  expoPushToken: string | null;
  walletProvider: 'phantom' | 'solflare' | 'manual' | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSettingsSchema = new Schema<IUserSettings>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    tradingMode: { type: String, default: 'SIGNAL_ONLY' },
    beginnerMode: { type: Boolean, default: true },
    notifyBuySetups: { type: Boolean, default: true },
    notifyFxSetups: { type: Boolean, default: true },
    notifyPaperExits: { type: Boolean, default: true },
    notifyRealTrades: { type: Boolean, default: true },
    telegramEnabled: { type: Boolean, default: true },
    whatsappEnabled: { type: Boolean, default: false },
    emailEnabled: { type: Boolean, default: true },
    killSwitch: { type: Boolean, default: true },
    emergencyStop: { type: Boolean, default: false },
    autoTradingEnabled: { type: Boolean, default: false },
    autoTradeMemecoins: { type: Boolean, default: false },
    autoTradeMemecoinAddresses: { type: [String], default: [] },
    autoTradeForex: { type: Boolean, default: false },
    walletPublicKey: { type: String, default: null },
    trackedWallets: {
      type: [
        {
          address: { type: String, required: true },
          label: { type: String, default: '' },
        },
      ],
      default: [],
    },
    maxSlippageBps: { type: Number, default: 300 },
    riskJson: { type: Schema.Types.Mixed, default: {} },
    alertChannelsHealed: { type: Boolean, default: false },
    notifyInApp: { type: Boolean, default: true },
    notifyPush: { type: Boolean, default: true },
    notifyBuyConfirms: { type: Boolean, default: true },
    notifySellConfirms: { type: Boolean, default: true },
    notifyTradeFailed: { type: Boolean, default: true },
    notifyTakeProfit: { type: Boolean, default: true },
    notifyStopLoss: { type: Boolean, default: true },
    expoPushToken: { type: String, default: null },
    walletProvider: { type: String, default: null },
  },
  { timestamps: true },
);

export const UserSettings: Model<IUserSettings> =
  mongoose.models.UserSettings ||
  mongoose.model<IUserSettings>('UserSettings', UserSettingsSchema);
