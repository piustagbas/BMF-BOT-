import {
  DISCOVERY_DEFAULTS,
  SMART_MONEY_SCORE_WEIGHTS,
} from '@memecoinbot/shared';
import { herfindahl, maxDrawdownFromPnls, pairRoundTrips, unrealizedPnl } from './trades';
import type {
  ClosedRoundTrip,
  DexTrade,
  SmartMoneyScoreWeights,
  WalletStats,
} from './types';

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function percentileRank(sorted: number[], value: number): number {
  if (!sorted.length) return 0.5;
  let lo = 0;
  for (const x of sorted) {
    if (x <= value) lo += 1;
  }
  return lo / sorted.length;
}

/** First time price is >= `mult` of the earliest observed price. */
export function firstSignificantMoveTime(
  trades: DexTrade[],
  token: string,
  asOf: number,
  mult = 1.4,
): number | null {
  const path = trades
    .filter((t) => t.token === token && t.timestamp <= asOf && t.price > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (path.length < 2) return null;
  const base = path[0]!.price;
  if (base <= 0) return null;
  for (const t of path) {
    if (t.price >= base * mult) return t.timestamp;
  }
  return null;
}

export function earlyEntryForWallet(
  trades: DexTrade[],
  wallet: string,
  asOf: number,
): number {
  const mine = trades.filter((t) => t.wallet === wallet && t.type === 'buy' && t.timestamp <= asOf);
  if (!mine.length) return 35;
  const tokens = [...new Set(mine.map((t) => t.token))];
  const scores: number[] = [];
  for (const token of tokens) {
    const tokenBuys = trades
      .filter((t) => t.token === token && t.type === 'buy' && t.timestamp <= asOf)
      .sort((a, b) => a.timestamp - b.timestamp);
    const firstMine = tokenBuys.find((t) => t.wallet === wallet);
    if (!firstMine) continue;
    const times = tokenBuys.map((t) => t.timestamp);
    const rank = 1 - percentileRank(times, firstMine.timestamp);
    const moveAt = firstSignificantMoveTime(trades, token, asOf);
    const beforeMove = moveAt == null ? 0.45 : firstMine.timestamp < moveAt ? 1 : 0.15;
    const mcap = firstMine.marketCap;
    const smallCap =
      mcap == null
        ? 0.5
        : mcap <= 150_000
          ? 1
          : mcap <= 500_000
            ? 0.8
            : mcap <= DISCOVERY_DEFAULTS.maxEntryMarketCapUsd
              ? 0.45
              : 0.1;
    scores.push((rank * 40 + beforeMove * 40 + smallCap * 20));
  }
  if (!scores.length) return 35;
  return Math.max(0, Math.min(100, mean(scores)));
}

export function computeWalletStats(
  address: string,
  trades: DexTrade[],
  asOf: number,
  markPriceByToken: Record<string, number> = {},
): WalletStats {
  const visible = trades.filter((t) => t.wallet === address && t.timestamp <= asOf);
  const { closed, open } = pairRoundTrips(visible, markPriceByToken);
  const knownClosed = closed.filter((c) => c.exitTime <= asOf);
  const wins = knownClosed.filter((c) => c.pnl > 0);
  const losses = knownClosed.filter((c) => c.pnl <= 0);
  const realized = knownClosed.reduce((a, c) => a + c.pnl, 0);
  const usdIn = knownClosed.reduce((a, c) => a + c.usdIn, 0);
  const profits = wins.map((c) => c.pnl);
  const lossVals = losses.map((c) => c.pnl);
  const hold = knownClosed.map((c) => c.holdMs);
  const tokens = new Set(visible.map((t) => t.token));
  const byTokenPnl = new Map<string, number>();
  for (const c of knownClosed) {
    byTokenPnl.set(c.token, (byTokenPnl.get(c.token) ?? 0) + c.pnl);
  }
  const concentration = herfindahl([...byTokenPnl.values()]);
  const profitableCalls = [...byTokenPnl.values()].filter((v) => v > 0).length;
  const failedCalls = [...byTokenPnl.values()].filter((v) => v <= 0).length;

  const chronological = [...knownClosed].sort((a, b) => a.exitTime - b.exitTime);
  const dd = maxDrawdownFromPnls(chronological.map((c) => c.pnl));
  const roiSeries = chronological.map((c) => c.roi);
  const consistency = consistencyFromRois(chronological);

  const firstSeen = visible.length ? Math.min(...visible.map((t) => t.timestamp)) : null;
  const lastActive = visible.length ? Math.max(...visible.map((t) => t.timestamp)) : null;
  const longevityHours =
    firstSeen != null && lastActive != null ? (lastActive - firstSeen) / 3_600_000 : 0;

  const memeBias = memeBiasScore(knownClosed, visible);
  const early = earlyEntryForWallet(trades, address, asOf);
  const avgWin = profits.length ? mean(profits) : 0;
  const avgLoss = lossVals.length ? Math.abs(mean(lossVals)) : 0;
  const expectancy = (wins.length / Math.max(knownClosed.length, 1)) * avgWin - (losses.length / Math.max(knownClosed.length, 1)) * avgLoss;
  const riskAdj = riskAdjustedScore(expectancy, dd, stdev(roiSeries), knownClosed.length);

  const n = knownClosed.length;
  const confidence = Math.max(
    0,
    Math.min(
      100,
      n * 8 +
        Math.min(tokens.size, 8) * 3 +
        (longevityHours >= 24 ? 10 : longevityHours >= 6 ? 5 : 0) -
        concentration * 25,
    ),
  );
  const luckScore = luckFromSample(n, wins.length / Math.max(n, 1), concentration);

  const exitQuality = exitQualityScore(knownClosed, trades, asOf);
  const unreal = unrealizedPnl(
    open.filter((o) => o.entryTime <= asOf),
    markPriceByToken,
  );

  return {
    address,
    totalTrades: n,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: n ? wins.length / n : 0,
    realizedPnl: realized,
    unrealizedPnl: unreal,
    roi: usdIn > 0 ? realized / usdIn : 0,
    averageProfit: avgWin,
    averageLoss: avgLoss,
    averageHoldMs: hold.length ? mean(hold) : 0,
    maxDrawdown: dd,
    tokensTraded: tokens.size,
    profitableCalls,
    failedCalls,
    earlyEntryScore: early,
    riskScore: 100 - riskAdj,
    firstSeen,
    lastActive,
    confidence,
    concentration,
    luckScore,
    consistency,
    exitQuality,
    longevity: Math.max(0, Math.min(100, longevityHours * 2)),
    memeBias,
  };
}

function consistencyFromRois(closed: ClosedRoundTrip[]): number {
  if (closed.length < 4) return 40;
  const thirds = splitByTime(closed, 3).map((chunk) => {
    const wr = chunk.filter((c) => c.pnl > 0).length / Math.max(chunk.length, 1);
    const r = mean(chunk.map((c) => c.roi));
    return wr * 50 + Math.max(-20, Math.min(50, r * 80));
  });
  const m = mean(thirds);
  const s = stdev(thirds);
  const penalty = s > 25 ? 20 : s > 12 ? 8 : 0;
  return Math.max(0, Math.min(100, m - penalty));
}

function splitByTime<T extends { exitTime: number }>(items: T[], parts: number): T[][] {
  if (!items.length) return Array.from({ length: parts }, () => []);
  const sorted = [...items].sort((a, b) => a.exitTime - b.exitTime);
  const size = Math.ceil(sorted.length / parts);
  const out: T[][] = [];
  for (let i = 0; i < parts; i++) {
    out.push(sorted.slice(i * size, (i + 1) * size));
  }
  return out;
}

function riskAdjustedScore(
  expectancy: number,
  drawdown: number,
  roiStd: number,
  n: number,
): number {
  let score = 50;
  if (expectancy > 0) score += Math.min(25, expectancy * 8);
  else score += Math.max(-25, expectancy * 8);
  if (drawdown > 0) score -= Math.min(20, Math.log10(1 + drawdown) * 6);
  if (roiStd > 1.5) score -= 10;
  else if (roiStd < 0.4 && n >= 6) score += 8;
  return Math.max(0, Math.min(100, score));
}

function luckFromSample(n: number, winRate: number, concentration: number): number {
  if (n < DISCOVERY_DEFAULTS.minTrades) return 80;
  let luck = 55;
  if (n >= 20) luck -= 20;
  else if (n >= 10) luck -= 10;
  if (concentration > 0.65) luck += 25;
  if (winRate > 0.85 && n < 10) luck += 15;
  return Math.max(0, Math.min(100, luck));
}

function memeBiasScore(closed: ClosedRoundTrip[], trades: DexTrade[]): number {
  const mcaps = closed
    .map((c) => c.entryMarketCap)
    .filter((m): m is number => m != null && m > 0);
  if (!mcaps.length) {
    const fromTrades = trades
      .filter((t) => t.type === 'buy' && t.marketCap != null)
      .map((t) => t.marketCap as number);
    if (!fromTrades.length) return 55;
    const small = fromTrades.filter((m) => m <= DISCOVERY_DEFAULTS.maxEntryMarketCapUsd).length;
    return (small / fromTrades.length) * 100;
  }
  const small = mcaps.filter((m) => m <= DISCOVERY_DEFAULTS.maxEntryMarketCapUsd).length;
  const verySmall = mcaps.filter((m) => m <= 400_000).length;
  return Math.max(0, Math.min(100, (small / mcaps.length) * 70 + (verySmall / mcaps.length) * 30));
}

function exitQualityScore(closed: ClosedRoundTrip[], trades: DexTrade[], asOf: number): number {
  if (!closed.length) return 45;
  const scores: number[] = [];
  for (const c of closed) {
    const after = trades.filter(
      (t) => t.token === c.token && t.timestamp > c.exitTime && t.timestamp <= asOf && t.price > 0,
    );
    if (!after.length) {
      scores.push(c.roi > 0 ? 62 : 40);
      continue;
    }
    const futureMax = Math.max(...after.map((t) => t.price));
    const futureMin = Math.min(...after.map((t) => t.price));
    if (c.roi > 0 && c.exitPrice >= futureMax * 0.85) scores.push(85);
    else if (c.roi > 0 && c.exitPrice > c.entryPrice) scores.push(68);
    else if (c.roi <= 0 && c.exitPrice <= futureMin * 1.15) scores.push(55);
    else if (c.roi <= 0) scores.push(32);
    else scores.push(50);
  }
  return mean(scores);
}

export function mergeScoreWeights(
  partial?: Partial<SmartMoneyScoreWeights>,
): SmartMoneyScoreWeights {
  const merged: SmartMoneyScoreWeights = {
    roiPnl: partial?.roiPnl ?? SMART_MONEY_SCORE_WEIGHTS.roiPnl,
    winRate: partial?.winRate ?? SMART_MONEY_SCORE_WEIGHTS.winRate,
    earlyEntry: partial?.earlyEntry ?? SMART_MONEY_SCORE_WEIGHTS.earlyEntry,
    consistency: partial?.consistency ?? SMART_MONEY_SCORE_WEIGHTS.consistency,
    riskAdjusted: partial?.riskAdjusted ?? SMART_MONEY_SCORE_WEIGHTS.riskAdjusted,
    memeCalls: partial?.memeCalls ?? SMART_MONEY_SCORE_WEIGHTS.memeCalls,
    exitQuality: partial?.exitQuality ?? SMART_MONEY_SCORE_WEIGHTS.exitQuality,
    longevity: partial?.longevity ?? SMART_MONEY_SCORE_WEIGHTS.longevity,
  };
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...SMART_MONEY_SCORE_WEIGHTS };
  return {
    roiPnl: merged.roiPnl / sum,
    winRate: merged.winRate / sum,
    earlyEntry: merged.earlyEntry / sum,
    consistency: merged.consistency / sum,
    riskAdjusted: merged.riskAdjusted / sum,
    memeCalls: merged.memeCalls / sum,
    exitQuality: merged.exitQuality / sum,
    longevity: merged.longevity / sum,
  };
}

export function scoreWallet(
  stats: WalletStats,
  weights?: Partial<SmartMoneyScoreWeights>,
): { score: number; components: Record<keyof SmartMoneyScoreWeights, number> } {
  const w = mergeScoreWeights(weights);
  const roiComponent = Math.max(0, Math.min(100, 50 + stats.roi * 80 + Math.tanh(stats.realizedPnl / 400) * 12));
  const winComponent = Math.max(0, Math.min(100, stats.winRate * 100));
  const early = stats.earlyEntryScore;
  const consistency = stats.consistency;
  const riskAdj = Math.max(0, 100 - stats.riskScore);
  const memeCalls = Math.max(
    0,
    Math.min(100, stats.memeBias * 0.6 + (stats.profitableCalls / Math.max(stats.tokensTraded, 1)) * 40),
  );
  const exit = stats.exitQuality;
  const longevity = stats.longevity;

  const components = {
    roiPnl: roiComponent,
    winRate: winComponent,
    earlyEntry: early,
    consistency,
    riskAdjusted: riskAdj,
    memeCalls,
    exitQuality: exit,
    longevity,
  };

  let acc = 0;
  (Object.keys(w) as Array<keyof SmartMoneyScoreWeights>).forEach((k) => {
    acc += components[k] * w[k];
  });
  acc -= stats.luckScore * 0.12;
  acc -= stats.concentration * 18;
  if (stats.totalTrades < DISCOVERY_DEFAULTS.minTrades) acc -= 12;
  return {
    score: Math.max(0, Math.min(100, Math.round(acc * 10) / 10)),
    components,
  };
}
