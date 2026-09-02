import mongoose, { Schema, type Document, type Model, Types } from 'mongoose';

export type NotificationType =
  | 'TRADE'
  | 'BUY'
  | 'SELL'
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'TX_PENDING'
  | 'TX_CONFIRMED'
  | 'TX_FAILED';

export interface INotificationAction {
  label: string;
  screen: string;
  params?: Record<string, string>;
}

export interface IAppNotification extends Document {
  userId: Types.ObjectId;
  eventId: string;
  type: NotificationType;
  title: string;
  body: string;
  tokenAddress: string | null;
  symbol: string | null;
  tradeId: string | null;
  positionId: string | null;
  action: INotificationAction | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AppNotificationSchema = new Schema<IAppNotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventId: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'TRADE',
        'BUY',
        'SELL',
        'TAKE_PROFIT',
        'STOP_LOSS',
        'TX_PENDING',
        'TX_CONFIRMED',
        'TX_FAILED',
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    tokenAddress: { type: String, default: null, index: true },
    symbol: { type: String, default: null },
    tradeId: { type: String, default: null },
    positionId: { type: String, default: null },
    action: { type: Schema.Types.Mixed, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AppNotificationSchema.index({ eventId: 1 }, { unique: true });
AppNotificationSchema.index({ userId: 1, createdAt: -1 });
AppNotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

export const AppNotification: Model<IAppNotification> =
  mongoose.models.AppNotification ||
  mongoose.model<IAppNotification>('AppNotification', AppNotificationSchema);
