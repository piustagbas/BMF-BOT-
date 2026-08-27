import { DISCOVERY_DEFAULTS, WalletTier } from '@memecoinbot/shared';
import type { WalletStats } from './types';

export function classifyWallet(params: {
  score: number;
  stats: WalletStats;
  excluded: boolean;
}): WalletTier {
  if (params.excluded) return WalletTier.D;
  const { score, stats } = params;
  const historyOk =
    stats.totalTrades >= DISCOVERY_DEFAULTS.minTrades &&
    stats.tokensTraded >= DISCOVERY_DEFAULTS.minTokens &&
    stats.confidence >= 35;
  if (!historyOk) return WalletTier.C;
  if (score >= 88 && stats.earlyEntryScore >= 70 && stats.consistency >= 60 && stats.luckScore <= 55) {
    return WalletTier.A;
  }
  if (score >= 74 && stats.winRate >= 0.55 && stats.memeBias >= 45) {
    return WalletTier.B;
  }
  if (score >= 58) return WalletTier.C;
  return WalletTier.D;
}

/** Only Tier A/B should meaningfully move the trading score. */
export function tierInfluence(tier: WalletTier): number {
  switch (tier) {
    case WalletTier.A:
      return 1;
    case WalletTier.B:
      return 0.7;
    case WalletTier.C:
      return 0.15;
    case WalletTier.D:
      return 0;
    default:
      return 0;
  }
}

export function tierLabel(tier: WalletTier): string {
  switch (tier) {
    case WalletTier.A:
      return 'Elite';
    case WalletTier.B:
      return 'Strong';
    case WalletTier.C:
      return 'Developing';
    default:
      return 'Low Quality';
  }
}
