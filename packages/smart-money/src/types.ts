import type { WalletTier } from '@memecoinbot/shared';

export type DexTradeKind = 'buy' | 'sell';

export type DexTrade = {
  wallet: string;
  token: string;
  symbol?: string;
  type: DexTradeKind;
  amount: number;
  usdValue: number;
  price: number;
  marketCap: number | null;
  liquidity: number | null;
  timestamp: number;
  txHash: string;
  provider?: string;
};

export type ClosedRoundTrip = {
  wallet: string;
  token: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  entryMarketCap: number | null;
  usdIn: number;
  usdOut: number;
  pnl: number;
  roi: number;
  holdMs: number;
  buyTx: string;
  sellTx: string;
};

export type OpenLot = {
  wallet: string;
  token: string;
  entryTime: number;
  entryPrice: number;
  remainingAmount: number;
  usdIn: number;
  entryMarketCap: number | null;
  buyTx: string;
};

export type WalletStats = {
  address: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  realizedPnl: number;
  unrealizedPnl: number;
  roi: number;
  averageProfit: number;
  averageLoss: number;
  averageHoldMs: number;
  maxDrawdown: number;
  tokensTraded: number;
  profitableCalls: number;
  failedCalls: number;
  earlyEntryScore: number;
  riskScore: number;
  firstSeen: number | null;
  lastActive: number | null;
  confidence: number;
  concentration: number;
  luckScore: number;
  consistency: number;
  exitQuality: number;
  longevity: number;
  memeBias: number;
};

export type SmartMoneyScoreWeights = {
  roiPnl: number;
  winRate: number;
  earlyEntry: number;
  consistency: number;
  riskAdjusted: number;
  memeCalls: number;
  exitQuality: number;
  longevity: number;
};

export type MemeCoinScoreWeights = {
  smartMoney: number;
  liquidity: number;
  volume: number;
  holders: number;
  pressure: number;
  technical5m: number;
  trend15m: number;
  risk: number;
};

export type DecayWeights = {
  last24h: number;
  last7d: number;
  last30d: number;
  allTime: number;
};

export type ScoredWallet = {
  address: string;
  smartScore: number;
  tier: WalletTier;
  stats: WalletStats;
  components: Record<keyof SmartMoneyScoreWeights, number>;
  excluded: boolean;
  excludeReasons: string[];
  influence: number;
};

export type ExclusionFlag =
  | 'DEPLOYER'
  | 'DEVELOPER'
  | 'LP'
  | 'EXCHANGE'
  | 'INFRASTRUCTURE'
  | 'MEV'
  | 'SNIPER'
  | 'MANIPULATION'
  | 'COPY_CLUSTER'
  | 'INSUFFICIENT_HISTORY'
  | 'LARGE_CAP_ONLY';

export type ConsensusBuyer = {
  address: string;
  tier: WalletTier;
  smartScore: number;
  buyTime: number;
  usdValue: number;
  entryMarketCap: number | null;
  clusterId: string | null;
};

export type ConsensusEvent = {
  token: string;
  symbol?: string;
  independentWallets: number;
  tierA: number;
  tierB: number;
  firstEntry: number;
  lastEntry: number;
  windowMs: number;
  strength: number;
  buyers: ConsensusBuyer[];
  reason: string;
};

export type TokenAnalysisInput = {
  liquidityUsd: number | null;
  liquidityGrowthPct: number | null;
  top10Pct: number | null;
  liquidityLockedOrBurned?: boolean | null;
  volume1m: number | null;
  volume5m: number | null;
  volume15m: number | null;
  volume24h: number | null;
  buys1m: number | null;
  sells1m: number | null;
  buys5m: number | null;
  sells5m: number | null;
  holderCount: number | null;
  holderGrowthPct: number | null;
  newWalletGrowthPct: number | null;
  marketCap: number | null;
  marketCapGrowthPct: number | null;
  technical5m: number;
  trend15mBullish: boolean;
  higherHighs: boolean;
  higherLows: boolean;
  breakout: boolean;
  volumeExpansion: boolean;
  hugeSingleCandle?: boolean;
};

export type RiskFlags = {
  concentratedOwnership: boolean;
  devDumping: boolean;
  liquidityRemoved: boolean;
  washTrading: boolean;
  bundledWallets: boolean;
  coordinatedBuying: boolean;
  highSlippage: boolean;
  honeypot: boolean;
  authorityRisk: boolean;
  smartMoneySelling: boolean;
  liquidityCollapse: boolean;
  reasons: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
};

export type MemeScoreBreakdown = {
  overall: number;
  smartMoney: number;
  liquidity: number;
  volume: number;
  holders: number;
  pressure: number;
  technical5m: number;
  trend15m: number;
  risk: number;
};
