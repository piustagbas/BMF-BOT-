export const FOREX_DISCLAIMER =
  'Forex trading involves substantial risk of loss. Setup quality is not a win probability, not financial advice, and no setup is certain. Paper/demo first. 18+ only.';

export const PIPELINE_STAGES = [
  'SCAN',
  'FILTER',
  'ANALYZE',
  'SCORE',
  'VALIDATE',
  'NOTIFY',
  'USER_CLICKS',
  'RECHECK',
  'EXECUTE',
  'PROTECT',
  'MONITOR',
  'MANAGE',
  'EXIT',
  'JOURNAL',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type FxSide = 'BUY' | 'SELL';
export type FxBias = 'BUY' | 'SELL' | 'WAIT';
export type FxMode = 'PAPER' | 'LIVE';
export type DataQuality = 'LIVE' | 'DEGRADED' | 'SYNTHETIC';
export type SessionName = 'SYDNEY' | 'TOKYO' | 'LONDON' | 'NEW_YORK' | 'CLOSED';

export type PipelineStep = {
  stage: PipelineStage;
  ok: boolean;
  at: string;
  note: string;
};

export type PairSpec = {
  symbol: string;
  base: string;
  quote: string;
  yahoo: string;
  pipSize: number;
  digits: number;
  contractSize: number;
  typicalSpreadPips: number;
  maxSpreadPips: number;
  assetClass: 'MAJOR' | 'CROSS' | 'METAL';
  correlatedWith: Array<{ symbol: string; corr: number }>;
};

export type FxQuote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spreadPips: number;
  timestamp: string;
  ageMs: number;
  stale: boolean;
  source: string;
  dataQuality: DataQuality;
};

export type EntryZone = {
  low: number;
  high: number;
  mid: number;
  widthPips: number;
};

export type FxBoardRow = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spreadPips: number;
  changePct: number;
  changePips: number;
  bias: FxBias;
  setupQuality: number;
  buyPct: number;
  sellPct: number;
  rsi: number | null;
  atrPips: number | null;
  tradeable: boolean;
  signalId: string | null;
  reasons: string[];
  blockers: string[];
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  zone: EntryZone | null;
  stale: boolean;
  dataQuality: DataQuality;
};

export type FxCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CalendarEvent = {
  id: string;
  name: string;
  currency: string;
  impact: 'HIGH' | 'MEDIUM';
  startsAt: string;
  endsAt: string;
};

export type SessionSnapshot = {
  name: SessionName;
  forexOpen: boolean;
  rollover: boolean;
  sessionOpenProtect: boolean;
  fridayCloseProtect: boolean;
  sundayOpenProtect: boolean;
  note: string;
};

export type ScoreBreakdown = {
  trend: number;
  pullback: number;
  structure: number;
  reward: number;
  spread: number;
  session: number;
  freshness: number;
  total: number;
};

export type CalibratedConfidence = {
  setupQuality: number;
  /** Conservative historical hit-rate band. Never equal to setupQuality. */
  estimatedHitRateLowPct: number | null;
  estimatedHitRateHighPct: number | null;
  sampleNote: string;
  warning: string;
};

export type FxSignal = {
  id: string;
  dedupeKey: string;
  symbol: string;
  side: FxSide;
  quote: FxQuote;
  zone: EntryZone;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  stopPips: number;
  tp1Pips: number;
  tp2Pips: number;
  riskReward1: number;
  suggestedLots: number;
  riskUsd: number;
  pipValueUsd: number;
  setupQuality: number;
  breakdown: ScoreBreakdown;
  confidence: CalibratedConfidence;
  reasons: string[];
  filtersFailed: string[];
  expiresAt: string;
  createdAt: string;
  pipeline: { stage: PipelineStage; steps: PipelineStep[] };
  notified: boolean;
};

export type ProtectRules = {
  sl: number;
  tp1: number;
  tp2: number;
  tp1ClosePct: number;
  tp2ClosePct: number;
  remainderPct: number;
  breakevenAfterR: number;
  trailAtrMult: number;
  maxSpreadPips: number;
  maxSlippagePips: number;
};

export type FxPosition = {
  id: string;
  signalId: string;
  symbol: string;
  side: FxSide;
  mode: FxMode;
  openedAt: string;
  entry: number;
  lotsOriginal: number;
  lotsOpen: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp1Filled: boolean;
  tp2Filled: boolean;
  breakevenOn: boolean;
  trailingOn: boolean;
  realizedUsd: number;
  unrealizedUsd: number;
  maePips: number;
  mfePips: number;
  protect: ProtectRules;
  events: string[];
  pipeline: { stage: PipelineStage; steps: PipelineStep[] };
};

export type JournalEntry = {
  id: string;
  positionId: string;
  signalId: string;
  symbol: string;
  side: FxSide;
  openedAt: string;
  closedAt: string;
  entry: number;
  exit: number;
  lots: number;
  pnlUsd: number;
  rMultiple: number;
  maePips: number;
  mfePips: number;
  setupQuality: number;
  exitReason: string;
  notes: string[];
};

export type RiskSnapshot = {
  balance: number;
  equity: number;
  dailyPnlUsd: number;
  weeklyPnlUsd: number;
  dailyDrawdownPct: number;
  weeklyDrawdownPct: number;
  dailyHalt: boolean;
  weeklyHalt: boolean;
  openPositions: number;
  maxOpen: number;
  usdExposureLots: number;
  correlationBlocks: string[];
  killSwitch: boolean;
  mode: FxMode;
  liveBlockedReason: string | null;
};

export const DEFAULT_FOREX_RISK = {
  startingBalance: 10_000,
  riskPerTradePct: 1,
  maxDailyLossPct: 3,
  maxWeeklyLossPct: 6,
  maxOpenPositions: 3,
  maxAbsCorrelation: 0.7,
  maxUsdExposureLots: 0.5,
  staleQuoteMs: 180_000,
  maxSlippagePips: 1.2,
  signalTtlMs: 45 * 60 * 1000,
  minSetupQuality: 62,
  minRiskReward: 1.4,
  newsBlackoutMinutes: 30,
  sessionOpenProtectMinutes: 20,
  rolloverUtcHour: 21,
  tp1ClosePct: 50,
  tp2ClosePct: 30,
  remainderPct: 20,
  breakevenAfterR: 1,
  trailAtrMult: 1.2,
  minLots: 0.01,
  maxLots: 1,
} as const;
