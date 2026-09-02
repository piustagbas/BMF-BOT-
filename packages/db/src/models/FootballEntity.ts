import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type FootballEntityType =
  | 'provider'
  | 'league'
  | 'season'
  | 'team'
  | 'fixture'
  | 'result'
  | 'standing'
  | 'team_statistics'
  | 'fixture_statistics'
  | 'head_to_head'
  | 'odds';

export interface IFootballEntity extends Document {
  entityType: FootballEntityType;
  internalId: string;
  provider: string;
  providerId: string;
  data: Record<string, unknown>;
  observedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FootballEntitySchema = new Schema<IFootballEntity>(
  {
    entityType: {
      type: String,
      enum: ['provider', 'league', 'season', 'team', 'fixture', 'result', 'standing', 'team_statistics', 'fixture_statistics', 'head_to_head', 'odds'],
      required: true,
      index: true,
    },
    internalId: { type: String, required: true },
    provider: { type: String, required: true, index: true },
    providerId: { type: String, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    observedAt: { type: Date, required: true, index: true },
  },
  { collection: 'football_entities', timestamps: true },
);
FootballEntitySchema.index({ entityType: 1, provider: 1, providerId: 1 }, { unique: true });
FootballEntitySchema.index({ entityType: 1, internalId: 1 });

export const FootballEntity: Model<IFootballEntity> =
  mongoose.models.FootballEntity ||
  mongoose.model<IFootballEntity>('FootballEntity', FootballEntitySchema);
