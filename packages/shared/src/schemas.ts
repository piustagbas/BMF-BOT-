import { z } from 'zod';
import {
  HolderRiskLevel,
  SignalType,
  StrategyId,
  TradingMode,
  WhaleActivity,
} from './constants';

export const TradingModeSchema = z.nativeEnum(TradingMode);
export const SignalTypeSchema = z.nativeEnum(SignalType);
export const StrategyIdSchema = z.nativeEnum(StrategyId);
export const HolderRiskLevelSchema = z.nativeEnum(HolderRiskLevel);
export const WhaleActivitySchema = z.nativeEnum(WhaleActivity);

export const TokenSummarySchema = z.object({
  address: z.string().min(32),
  name: z.string(),
  symbol: z.string(),
  priceUsd: z.number().nonnegative().nullable(),
  marketCap: z.number().nonnegative().nullable(),
  fdv: z.number().nonnegative().nullable(),
  liquidityUsd: z.number().nonnegative().nullable(),
  volume24h: z.number().nonnegative().nullable(),
  priceChange24h: z.number().nullable(),
  buys24h: z.number().int().nonnegative().nullable(),
  sells24h: z.number().int().nonnegative().nullable(),
  pairAgeHours: z.number().nonnegative().nullable(),
  dexId: z.string().nullable(),
  pairAddress: z.string().nullable(),
});

export type TokenSummary = z.infer<typeof TokenSummarySchema>;

export const ScoreBreakdownSchema = z.object({
  safetyScore: z.number().min(0).max(100),
  signalScore: z.number().min(0).max(100),
  axiomScore: z.number().min(0).max(100).nullable(),
  axiomUnavailable: z.boolean().default(false),
});

export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(['ONLINE', 'DEGRADED', 'OFFLINE']),
  version: z.string(),
  tradingMode: TradingModeSchema,
  autoTradingEnabled: z.boolean(),
  killSwitch: z.boolean(),
  timestamp: z.string(),
  sources: z.record(
    z.object({
      status: z.enum(['ONLINE', 'DEGRADED', 'OFFLINE']),
      message: z.string().optional(),
    }),
  ),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
