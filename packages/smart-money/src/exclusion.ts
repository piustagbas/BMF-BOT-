import { DISCOVERY_DEFAULTS } from '@memecoinbot/shared';
import type { DexTrade, ExclusionFlag, WalletStats } from './types';

const KNOWN_INFRA = new Set(
  [
    '11111111111111111111111111111111',
    'So11111111111111111111111111111111111111112',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM',
    'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEhyF2Kfg',
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    '5tzFkiKscXHK5ZXCAmPqzGBqbwbx4t5eXvz4MFuns1hF',
    'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiKLnC',
    'AC5RDfQFmDS1deWZos921J6sdvJUJU6YQ7gCk6hGQArs',
    'GJRs4FwHmaZShaTwgLkpPQkjXsQFKCbBz9TXMdY2hzJK',
  ].map((a) => a.trim()),
);

export function isKnownInfrastructure(address: string): boolean {
  return KNOWN_INFRA.has(address);
}

export function extraInfrastructureAddresses(envValue?: string): string[] {
  if (!envValue?.trim()) return [];
  return envValue
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function evaluateExclusions(params: {
  address: string;
  stats: WalletStats;
  trades: DexTrade[];
  deployers?: Set<string>;
  lpWallets?: Set<string>;
  extraInfra?: string[];
  clustered?: boolean;
}): { excluded: boolean; flags: ExclusionFlag[]; reasons: string[] } {
  const flags: ExclusionFlag[] = [];
  const reasons: string[] = [];
  const { address, stats, trades } = params;

  if (isKnownInfrastructure(address) || params.extraInfra?.includes(address)) {
    flags.push('INFRASTRUCTURE');
    reasons.push('Known infrastructure / routing wallet');
  }
  if (params.deployers?.has(address)) {
    flags.push('DEPLOYER');
    reasons.push('Token deployer / creator wallet');
  }
  if (params.lpWallets?.has(address)) {
    flags.push('LP');
    reasons.push('Liquidity-provider wallet');
  }

  const mine = trades.filter((t) => t.wallet === address);
  const holds = mine.filter((t) => t.type === 'buy' || t.type === 'sell').map((t) => t);
  const roundTripHolds = stats.averageHoldMs;
  if (stats.totalTrades >= 4 && roundTripHolds > 0 && roundTripHolds <= DISCOVERY_DEFAULTS.sniperHoldSeconds * 1000) {
    flags.push('SNIPER');
    reasons.push('Sniper-only pattern: extremely short holds');
  }

  const uniqueTokens = new Set(mine.map((t) => t.token)).size;
  const buyCount = mine.filter((t) => t.type === 'buy').length;
  const sellCount = mine.filter((t) => t.type === 'sell').length;
  if (uniqueTokens >= 8 && buyCount >= 12 && Math.abs(buyCount - sellCount) <= 2 && stats.averageHoldMs < 20_000) {
    flags.push('MEV');
    reasons.push('MEV / arb-like round-trips across many tokens');
  }

  if (stats.totalTrades < DISCOVERY_DEFAULTS.minTrades || stats.tokensTraded < 2) {
    flags.push('INSUFFICIENT_HISTORY');
    reasons.push('Insufficient historical trades to classify as smart money');
  }

  if (stats.memeBias < 25 && stats.tokensTraded >= 3) {
    flags.push('LARGE_CAP_ONLY');
    reasons.push('PnL looks driven by large-cap names, not early meme discovery');
  }

  const sameBlockPairs = countSameTimestampPairs(holds);
  if (sameBlockPairs >= 6) {
    flags.push('MANIPULATION');
    reasons.push('Repeated same-timestamp two-sided flow');
  }

  if (params.clustered) {
    flags.push('COPY_CLUSTER');
    reasons.push('Transactions look copied with a related cluster');
  }

  const hard = flags.filter(
    (f) =>
      f === 'INFRASTRUCTURE' ||
      f === 'EXCHANGE' ||
      f === 'DEPLOYER' ||
      f === 'MEV' ||
      f === 'MANIPULATION',
  );
  const excluded = hard.length > 0 || (flags.includes('SNIPER') && stats.memeBias < 40);
  return { excluded, flags, reasons };
}

function countSameTimestampPairs(trades: DexTrade[]): number {
  const byTs = new Map<number, DexTrade[]>();
  for (const t of trades) {
    const list = byTs.get(t.timestamp) ?? [];
    list.push(t);
    byTs.set(t.timestamp, list);
  }
  let n = 0;
  for (const list of byTs.values()) {
    const buys = list.filter((t) => t.type === 'buy').length;
    const sells = list.filter((t) => t.type === 'sell').length;
    if (buys && sells) n += 1;
  }
  return n;
}
