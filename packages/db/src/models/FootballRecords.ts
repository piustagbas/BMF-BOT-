import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IFootballFixtureRecord extends Document {
  internalId: string;
  providerIds: Record<string, string>;
  fixture: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  provenance: Record<string, unknown>;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FootballFixtureSchema = new Schema<IFootballFixtureRecord>(
  {
    internalId: { type: String, required: true, unique: true, index: true },
    providerIds: { type: Schema.Types.Mixed, default: {} },
    fixture: { type: Schema.Types.Mixed, required: true },
    result: { type: Schema.Types.Mixed, default: null },
    provenance: { type: Schema.Types.Mixed, default: {} },
    lastSyncedAt: { type: Date, required: true, index: true },
  },
  { collection: 'football_fixtures', timestamps: true },
);

export interface IFootballPredictionRecord extends Document {
  fixtureId: string;
  generatedAt: Date;
  modelVersion: string;
  predictions: unknown[];
  openAiAnalysis?: Record<string, unknown> | null;
  createdAt: Date;
}

const FootballPredictionSchema = new Schema<IFootballPredictionRecord>(
  {
    fixtureId: { type: String, required: true, index: true },
    generatedAt: { type: Date, required: true, index: true },
    modelVersion: { type: String, required: true },
    predictions: { type: [Schema.Types.Mixed], default: [] },
    openAiAnalysis: { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'football_predictions', timestamps: { createdAt: true, updatedAt: false } },
);
FootballPredictionSchema.index({ fixtureId: 1, modelVersion: 1, generatedAt: -1 });

export interface IFootballBacktestRecord extends Document {
  runId: string;
  from: string;
  to: string;
  report: Record<string, unknown>;
  createdAt: Date;
}

const FootballBacktestSchema = new Schema<IFootballBacktestRecord>(
  {
    runId: { type: String, required: true, unique: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    report: { type: Schema.Types.Mixed, required: true },
  },
  { collection: 'football_backtests', timestamps: { createdAt: true, updatedAt: false } },
);

export interface IFootballSyncLog extends Document {
  provider: string;
  startedAt: Date;
  completedAt: Date;
  status: string;
  responseTimeMs: number | null;
  fixturesReceived: number;
  errorCount: number;
  rateLimitResponses: number;
  message?: string;
}

const FootballSyncLogSchema = new Schema<IFootballSyncLog>(
  {
    provider: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    status: { type: String, required: true },
    responseTimeMs: { type: Number, default: null },
    fixturesReceived: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    rateLimitResponses: { type: Number, default: 0 },
    message: { type: String, default: '' },
  },
  { collection: 'football_provider_sync_logs', timestamps: true },
);

export const FootballFixtureRecord: Model<IFootballFixtureRecord> =
  mongoose.models.FootballFixtureRecord ||
  mongoose.model<IFootballFixtureRecord>('FootballFixtureRecord', FootballFixtureSchema);
export const FootballPredictionRecord: Model<IFootballPredictionRecord> =
  mongoose.models.FootballPredictionRecord ||
  mongoose.model<IFootballPredictionRecord>('FootballPredictionRecord', FootballPredictionSchema);
export const FootballBacktestRecord: Model<IFootballBacktestRecord> =
  mongoose.models.FootballBacktestRecord ||
  mongoose.model<IFootballBacktestRecord>('FootballBacktestRecord', FootballBacktestSchema);
export const FootballSyncLog: Model<IFootballSyncLog> =
  mongoose.models.FootballSyncLog ||
  mongoose.model<IFootballSyncLog>('FootballSyncLog', FootballSyncLogSchema);
