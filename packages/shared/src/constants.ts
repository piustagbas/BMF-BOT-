export enum TradingMode {
  SIGNAL_ONLY = 'SIGNAL_ONLY',
  PAPER = 'PAPER',
  MANUAL_REAL = 'MANUAL_REAL',
  AUTO = 'AUTO',
}

export enum SignalType {
  WATCH = 'WATCH',
  SETUP_FORMING = 'SETUP_FORMING',
  BUY = 'BUY',
  HOLD = 'HOLD',
  TAKE_PROFIT = 'TAKE_PROFIT',
  SELL = 'SELL',
  STOP_LOSS = 'STOP_LOSS',
  EMERGENCY_EXIT = 'EMERGENCY_EXIT',
  NO_TRADE = 'NO_TRADE',
}

export enum HolderRiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum WhaleActivity {
  ACCUMULATION = 'ACCUMULATION',
  NEUTRAL = 'NEUTRAL',
  DISTRIBUTION = 'DISTRIBUTION',
  SUSPICIOUS = 'SUSPICIOUS',
}

export enum HealthStatus {
  ONLINE = 'ONLINE',
  DEGRADED = 'DEGRADED',
  OFFLINE = 'OFFLINE',
}

export enum StrategyId {
  MOMENTUM_BREAKOUT = 'MOMENTUM_BREAKOUT',
  BREAKOUT_RETEST = 'BREAKOUT_RETEST',
  EMA_TREND_CONTINUATION = 'EMA_TREND_CONTINUATION',
  VWAP_RECLAIM = 'VWAP_RECLAIM',
  VOLUME_EXPANSION = 'VOLUME_EXPANSION',
}

export const DISCLAIMER =
  'This is not financial advice. Meme coins are highly volatile. Setups are potential only — never guaranteed.';

export const DEFAULT_RISK = {
  safetyMin: 80,
  signalMin: 80,
  riskPerTradePct: 1,
  maxDailyLossPct: 5,
  maxOpenPositions: 5,
  maxDailyTrades: 20,
  maxPositionPct: 20,
  maxExposurePct: 50,
  minRiskReward: 2,
  maxConsecutiveLosses: 3,
  cooldownAfterLosingStreakMinutes: 60,
  tp1Pct: 30,
  tp1SellPct: 30,
  tp2Pct: 60,
  tp2SellPct: 40,
  remainingPct: 30,
  paperBalance: 1000,
} as const;

export const DEFAULT_TRADING_FLAGS = {
  tradingMode: TradingMode.SIGNAL_ONLY,
  autoTradingEnabled: false,
  killSwitch: true,
  axiomRequiredForAutoTrading: true,
} as const;

export const SAFETY_WEIGHTS = {
  tokenSecurity: 0.25,
  liquidity: 0.2,
  holderDistribution: 0.15,
  tradingActivity: 0.15,
  volumeQuality: 0.1,
  developerActivity: 0.1,
  tokenHistory: 0.05,
} as const;

export const SIGNAL_WEIGHTS = {
  safety: 0.35,
  momentum: 0.2,
  volume: 0.15,
  technicalStructure: 0.15,
  liquidity: 0.1,
  onChainConfirmation: 0.05,
} as const;

/** Final buy score: only buy when several of these independent inputs agree. */
export const BUY_SCORE_WEIGHTS = {
  safety: 0.22,
  technical: 0.16,
  momentum: 0.16,
  candlestick: 0.12,
  smartMoney: 0.12,
  social: 0.12,
  fomoQuality: 0.1,
} as const;

export const MASTER_STRATEGY = {
  componentAgreeMin: 60,
  independentMin: 3,
  fomoExtremeMin: 75,
  pumpRiskMin: 70,
} as const;

export type SmartWalletOrigin = 'VERIFIED' | 'USER' | 'DISCOVERED';

export type SmartWallet = {
  address: string;
  label: string;
  origin: SmartWalletOrigin;
};

export enum WalletTier {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
}

export enum MemeSignalLevel {
  VERY_STRONG = 'VERY_STRONG',
  STRONG = 'STRONG',
  WATCH = 'WATCH',
  WEAK = 'WEAK',
  AVOID = 'AVOID',
}

/** 0–100 wallet quality. Do not rank by total PnL alone. */
export const SMART_MONEY_SCORE_WEIGHTS = {
  roiPnl: 0.25,
  winRate: 0.2,
  earlyEntry: 0.2,
  consistency: 0.1,
  riskAdjusted: 0.1,
  memeCalls: 0.05,
  exitQuality: 0.05,
  longevity: 0.05,
} as const;

/** Overall meme-coin score. Smart money is one input, never an automatic BUY. */
export const MEME_COIN_SCORE_WEIGHTS = {
  smartMoney: 0.3,
  liquidity: 0.15,
  volume: 0.15,
  holders: 0.1,
  pressure: 0.1,
  technical5m: 0.1,
  trend15m: 0.05,
  risk: 0.05,
} as const;

export const SMART_MONEY_DECAY_WEIGHTS = {
  last24h: 0.35,
  last7d: 0.25,
  last30d: 0.2,
  allTime: 0.2,
} as const;

export const DISCOVERY_DEFAULTS = {
  minTrades: 5,
  minTokens: 3,
  minHistoryHours: 6,
  maxEntryMarketCapUsd: 5_000_000,
  sniperHoldSeconds: 90,
  copyTradeWindowMs: 8_000,
  entityJaccard: 0.82,
  consensusMinWallets: 3,
  consensusMaxWindowMs: 15 * 60 * 1000,
  maxTokensPerCycle: 8,
  maxCandidatesPerToken: 40,
  maxTrackedWallets: 80,
} as const;

/**
 * Publicly labeled wallets. Keep this list conservative — users can add their own.
 * Override / extend with env VERIFIED_SMART_WALLETS=address:Label,address:Label
 */
export const VERIFIED_SMART_WALLETS: SmartWallet[] = [];

/** Scanner / signals: pairs from 1 minute to 30 days. Scam flags still block BUY. */
export const NEW_COIN_MIN_AGE_HOURS = 1 / 60;
export const NEW_COIN_MAX_AGE_HOURS = 24 * 30;

export function isNewCoinAge(pairAgeHours: number | null | undefined): boolean {
  if (pairAgeHours == null || !Number.isFinite(pairAgeHours)) return false;
  return (
    pairAgeHours >= NEW_COIN_MIN_AGE_HOURS && pairAgeHours <= NEW_COIN_MAX_AGE_HOURS
  );
}

export function formatPairAgeHours(pairAgeHours: number | null | undefined): string | null {
  if (pairAgeHours == null || !Number.isFinite(pairAgeHours)) return null;
  if (pairAgeHours < 1) {
    const mins = Math.max(1, Math.round(pairAgeHours * 60));
    return `${mins}m old`;
  }
  if (pairAgeHours < 24) return `${Math.max(1, Math.round(pairAgeHours))}h old`;
  const days = Math.round((pairAgeHours / 24) * 10) / 10;
  return `${days}d old`;
}

/** Pair URL when known; otherwise the mint. Universal links open the DexScreener app if installed. */
export function dexScreenerSolanaUrl(
  mint: string,
  pairAddress?: string | null,
): string {
  const id = (pairAddress?.trim() || mint.trim()).replace(/[^\w]/g, '');
  return `https://dexscreener.com/solana/${id}`;
}
