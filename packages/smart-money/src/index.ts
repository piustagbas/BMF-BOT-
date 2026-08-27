export type {
  ClosedRoundTrip,
  ConsensusBuyer,
  ConsensusEvent,
  DexTrade,
  ExclusionFlag,
  MemeScoreBreakdown,
  OpenLot,
  RiskFlags,
  ScoredWallet,
  TokenAnalysisInput,
  WalletStats,
} from './types';
export { pairRoundTrips, unrealizedPnl, maxDrawdownFromPnls, clampScore } from './trades';
export {
  computeWalletStats,
  scoreWallet,
  mergeScoreWeights,
  earlyEntryForWallet,
} from './scoring';
export { classifyWallet, tierInfluence, tierLabel } from './classification';
export { evaluateExclusions, isKnownInfrastructure, extraInfrastructureAddresses } from './exclusion';
export { clusterWallets, clusterIdFor } from './clustering';
export { backtestWallet } from './backtest';
export { decayedSmartScore, mergeDecayWeights } from './decay';
export { detectConsensus } from './consensus';
export type { RecentBuy } from './consensus';
export { analyzeTokenMarket } from './token-analyzer';
export { detectRisk, riskToScore } from './risk-detector';
export type { RiskDetectorInput } from './risk-detector';
export {
  computeMemeCoinScore,
  mergeMemeWeights,
  memeSignalLevel,
} from './signal';
export type { MemeSignalResult } from './signal';
export { formatSmartMoneyAlert, dashboardStatus } from './alerts';
export type { SmartMoneyAlertPayload } from './alerts';
