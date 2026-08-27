import { DISCOVERY_DEFAULTS } from '@memecoinbot/shared';
import type { DexTrade } from './types';

export type WalletCluster = {
  id: string;
  wallets: string[];
};

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function tokensOf(trades: DexTrade[], wallet: string): Set<string> {
  return new Set(trades.filter((t) => t.wallet === wallet).map((t) => t.token));
}

function copyHits(a: DexTrade[], b: DexTrade[], windowMs: number): number {
  let hits = 0;
  const bBuys = b.filter((t) => t.type === 'buy');
  for (const ta of a.filter((t) => t.type === 'buy')) {
    if (
      bBuys.some(
        (tb) =>
          tb.token === ta.token &&
          Math.abs(tb.timestamp - ta.timestamp) <= windowMs &&
          (tb.txHash === ta.txHash ||
            Math.abs(tb.usdValue - ta.usdValue) / Math.max(ta.usdValue, 1) < 0.08),
      )
    ) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * Group wallets that look like the same entity or copy-traders.
 * Independent confirmations must not count clustered wallets twice.
 */
export function clusterWallets(trades: DexTrade[], windowMs = DISCOVERY_DEFAULTS.copyTradeWindowMs): WalletCluster[] {
  const wallets = [...new Set(trades.map((t) => t.wallet))].filter(Boolean);
  const parent = new Map<string, string>();
  for (const w of wallets) parent.set(w, w);
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p !== x) {
      const r = find(p);
      parent.set(x, r);
      return r;
    }
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const tokenSets = new Map(wallets.map((w) => [w, tokensOf(trades, w)] as const));
  const byWallet = new Map<string, DexTrade[]>();
  for (const t of trades) {
    const list = byWallet.get(t.wallet) ?? [];
    list.push(t);
    byWallet.set(t.wallet, list);
  }

  for (let i = 0; i < wallets.length; i++) {
    for (let j = i + 1; j < wallets.length; j++) {
      const a = wallets[i]!;
      const b = wallets[j]!;
      const jac = jaccard(tokenSets.get(a)!, tokenSets.get(b)!);
      const ta = byWallet.get(a) ?? [];
      const tb = byWallet.get(b) ?? [];
      const hits = copyHits(ta, tb, windowMs);
      const minBuys = Math.min(
        ta.filter((t) => t.type === 'buy').length,
        tb.filter((t) => t.type === 'buy').length,
      );
      const copyRatio = minBuys ? hits / minBuys : 0;
      if (jac >= DISCOVERY_DEFAULTS.entityJaccard && copyRatio >= 0.45) union(a, b);
      else if (copyRatio >= 0.7 && hits >= 3) union(a, b);
    }
  }

  const groups = new Map<string, string[]>();
  for (const w of wallets) {
    const r = find(w);
    const list = groups.get(r) ?? [];
    list.push(w);
    groups.set(r, list);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((walletsInCluster, i) => ({
      id: `cluster_${i + 1}`,
      wallets: walletsInCluster.sort(),
    }));
}

export function clusterIdFor(
  clusters: WalletCluster[],
  address: string,
): string | null {
  for (const c of clusters) {
    if (c.wallets.includes(address)) return c.id;
  }
  return null;
}
