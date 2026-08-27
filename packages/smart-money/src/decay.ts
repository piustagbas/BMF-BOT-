import { SMART_MONEY_DECAY_WEIGHTS } from '@memecoinbot/shared';
import { computeWalletStats, scoreWallet } from './scoring';
import type { DecayWeights, DexTrade } from './types';

export function mergeDecayWeights(partial?: Partial<DecayWeights>): DecayWeights {
  const merged: DecayWeights = {
    last24h: partial?.last24h ?? SMART_MONEY_DECAY_WEIGHTS.last24h,
    last7d: partial?.last7d ?? SMART_MONEY_DECAY_WEIGHTS.last7d,
    last30d: partial?.last30d ?? SMART_MONEY_DECAY_WEIGHTS.last30d,
    allTime: partial?.allTime ?? SMART_MONEY_DECAY_WEIGHTS.allTime,
  };
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...SMART_MONEY_DECAY_WEIGHTS };
  return {
    last24h: merged.last24h / sum,
    last7d: merged.last7d / sum,
    last30d: merged.last30d / sum,
    allTime: merged.allTime / sum,
  };
}

function windowScore(
  address: string,
  trades: DexTrade[],
  now: number,
  windowMs: number | null,
  mark: Record<string, number>,
): { score: number; samples: number } {
  const from = windowMs == null ? 0 : now - windowMs;
  const slice = trades.filter((t) => t.timestamp >= from && t.timestamp <= now);
  const stats = computeWalletStats(address, slice, now, mark);
  if (stats.totalTrades < 2 && windowMs != null) {
    return { score: 50, samples: stats.totalTrades };
  }
  return { score: scoreWallet(stats).score, samples: stats.totalTrades };
}

/**
 * Recent performance has meaningful influence. Status is never permanent.
 */
export function decayedSmartScore(
  address: string,
  trades: DexTrade[],
  now = Date.now(),
  markPriceByToken: Record<string, number> = {},
  weights?: Partial<DecayWeights>,
): { score: number; windows: Record<keyof DecayWeights, number> } {
  const w = mergeDecayWeights(weights);
  const last24h = windowScore(address, trades, now, 24 * 3600_000, markPriceByToken);
  const last7d = windowScore(address, trades, now, 7 * 24 * 3600_000, markPriceByToken);
  const last30d = windowScore(address, trades, now, 30 * 24 * 3600_000, markPriceByToken);
  const allTime = windowScore(address, trades, now, null, markPriceByToken);

  const parts: Array<[keyof DecayWeights, { score: number; samples: number }]> = [
    ['last24h', last24h],
    ['last7d', last7d],
    ['last30d', last30d],
    ['allTime', allTime],
  ];
  let weightSum = 0;
  let acc = 0;
  for (const [key, part] of parts) {
    const usable = key === 'allTime' || part.samples >= 2;
    if (!usable) continue;
    weightSum += w[key];
    acc += part.score * w[key];
  }
  const score = weightSum > 0 ? acc / weightSum : allTime.score;
  return {
    score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)),
    windows: {
      last24h: last24h.score,
      last7d: last7d.score,
      last30d: last30d.score,
      allTime: allTime.score,
    },
  };
}
