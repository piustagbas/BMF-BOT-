import { computeWalletStats, scoreWallet } from './scoring';
import type { DexTrade, WalletStats } from './types';

export type WalkForwardPoint = {
  asOf: number;
  tradesKnown: number;
  winRate: number;
  roi: number;
  score: number;
};

export type WalletBacktest = {
  stats: WalletStats;
  walkForward: WalkForwardPoint[];
  avgGainAfterEntry: number;
  failRate: number;
  earlyHits: number;
  earlyAttempts: number;
  concentrated: boolean;
  likelyLuck: boolean;
  consistent: boolean;
};

/**
 * Historical performance using only information available at each `asOf`.
 * Outcomes after an entry are measured, but wallet quality at time T never uses later fills.
 */
export function backtestWallet(
  address: string,
  trades: DexTrade[],
  markPriceByToken: Record<string, number> = {},
): WalletBacktest {
  const mine = trades.filter((t) => t.wallet === address).sort((a, b) => a.timestamp - b.timestamp);
  const checkpoints: number[] = [];
  for (let i = 0; i < mine.length; i++) {
    if (i === mine.length - 1 || i % 3 === 0) checkpoints.push(mine[i]!.timestamp);
  }
  if (!checkpoints.length && mine.length) checkpoints.push(mine[mine.length - 1]!.timestamp);

  const walkForward: WalkForwardPoint[] = checkpoints.map((asOf) => {
    const stats = computeWalletStats(address, trades, asOf, markPriceByToken);
    const { score } = scoreWallet(stats);
    return {
      asOf,
      tradesKnown: stats.totalTrades,
      winRate: stats.winRate,
      roi: stats.roi,
      score,
    };
  });

  const now = mine.length ? mine[mine.length - 1]!.timestamp : Date.now();
  const stats = computeWalletStats(address, trades, now, markPriceByToken);

  const buys = mine.filter((t) => t.type === 'buy');
  let gainSum = 0;
  let gainN = 0;
  let fails = 0;
  let earlyHits = 0;
  for (const buy of buys) {
    const after = trades.filter(
      (t) => t.token === buy.token && t.timestamp > buy.timestamp && t.price > 0,
    );
    if (!after.length) continue;
    const horizon = after.filter((t) => t.timestamp <= buy.timestamp + 6 * 3600_000);
    const path = horizon.length ? horizon : after;
    const maxPx = Math.max(...path.map((t) => t.price));
    const gain = buy.price > 0 ? (maxPx - buy.price) / buy.price : 0;
    gainSum += gain;
    gainN += 1;
    if (gain < 0.05) fails += 1;
    if (gain >= 0.4) earlyHits += 1;
  }

  const scores = walkForward.map((p) => p.score);
  const consistent =
    scores.length >= 3 &&
    scores.every((s) => s >= 50) &&
    Math.max(...scores) - Math.min(...scores) < 35;

  return {
    stats,
    walkForward,
    avgGainAfterEntry: gainN ? gainSum / gainN : 0,
    failRate: gainN ? fails / gainN : 1,
    earlyHits,
    earlyAttempts: gainN,
    concentrated: stats.concentration > 0.65,
    likelyLuck: stats.luckScore >= 70 || stats.concentration > 0.7,
    consistent,
  };
}
