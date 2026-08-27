import { DISCOVERY_DEFAULTS, WalletTier } from '@memecoinbot/shared';
import { clusterIdFor, clusterWallets } from './clustering';
import { tierInfluence } from './classification';
import type { ConsensusBuyer, ConsensusEvent, ScoredWallet } from './types';

export type RecentBuy = {
  address: string;
  token: string;
  symbol?: string;
  buyTime: number;
  usdValue: number;
  entryMarketCap: number | null;
};

export function detectConsensus(params: {
  token: string;
  symbol?: string;
  buys: RecentBuy[];
  wallets: ScoredWallet[];
  now?: number;
  maxWindowMs?: number;
}): ConsensusEvent | null {
  const maxWindow = params.maxWindowMs ?? DISCOVERY_DEFAULTS.consensusMaxWindowMs;
  const byAddr = new Map(params.wallets.map((w) => [w.address, w]));
  const tokenBuys = params.buys
    .filter((b) => b.token === params.token)
    .sort((a, b) => a.buyTime - b.buyTime);
  if (!tokenBuys.length) return null;

  const clusters = clusterWallets(
    tokenBuys.map((b) => ({
      wallet: b.address,
      token: b.token,
      type: 'buy' as const,
      amount: 1,
      usdValue: b.usdValue,
      price: 1,
      marketCap: b.entryMarketCap,
      liquidity: null,
      timestamp: b.buyTime,
      txHash: `${b.address}:${b.buyTime}`,
    })),
  );

  const seenClusters = new Set<string>();
  const independent: ConsensusBuyer[] = [];
  for (const buy of tokenBuys) {
    const scored = byAddr.get(buy.address);
    if (!scored || scored.excluded) continue;
    if (scored.tier !== WalletTier.A && scored.tier !== WalletTier.B) continue;
    const cid = clusterIdFor(clusters, buy.address);
    if (cid) {
      if (seenClusters.has(cid)) continue;
      seenClusters.add(cid);
    }
    independent.push({
      address: buy.address,
      tier: scored.tier,
      smartScore: scored.smartScore,
      buyTime: buy.buyTime,
      usdValue: buy.usdValue,
      entryMarketCap: buy.entryMarketCap,
      clusterId: cid,
    });
  }

  if (independent.length < DISCOVERY_DEFAULTS.consensusMinWallets) return null;

  const first = independent[0]!.buyTime;
  const last = independent[independent.length - 1]!.buyTime;
  const windowMs = Math.max(0, last - first);
  if (windowMs > maxWindow) {
    const recent = independent.filter((b) => last - b.buyTime <= maxWindow);
    if (recent.length >= DISCOVERY_DEFAULTS.consensusMinWallets) {
      return buildEvent(params.token, params.symbol, recent);
    }
    return null;
  }
  return buildEvent(params.token, params.symbol, independent);
}

function buildEvent(token: string, symbol: string | undefined, buyers: ConsensusBuyer[]): ConsensusEvent {
  const first = Math.min(...buyers.map((b) => b.buyTime));
  const last = Math.max(...buyers.map((b) => b.buyTime));
  const windowMs = Math.max(1, last - first);
  const tierA = buyers.filter((b) => b.tier === WalletTier.A).length;
  const tierB = buyers.filter((b) => b.tier === WalletTier.B).length;
  const quality = buyers.reduce((a, b) => a + b.smartScore * tierInfluence(b.tier), 0) / buyers.length;
  const tightness = Math.max(0, 1 - windowMs / DISCOVERY_DEFAULTS.consensusMaxWindowMs);
  const countBoost = Math.min(1, (buyers.length - 2) / 8);
  const strength = Math.max(
    0,
    Math.min(100, quality * 0.55 + tightness * 25 + countBoost * 20 + Math.min(tierA, 6) * 3),
  );
  const mins = Math.max(1, Math.round(windowMs / 60000));
  return {
    token,
    symbol,
    independentWallets: buyers.length,
    tierA,
    tierB,
    firstEntry: first,
    lastEntry: last,
    windowMs,
    strength: Math.round(strength * 10) / 10,
    buyers,
    reason: `${tierA} Tier A and ${tierB} Tier B wallets independently accumulated this token within ${mins} minute${mins === 1 ? '' : 's'}`,
  };
}
