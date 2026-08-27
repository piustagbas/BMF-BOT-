import type { PriceConsensus } from './types';

const DEFAULT_MAX_DEVIATION_PCT = 15;

export function comparePrices(
  dexscreenerPrice: number | null,
  jupiterPrice: number | null,
  maxDeviationPct = DEFAULT_MAX_DEVIATION_PCT,
): PriceConsensus {
  if (
    dexscreenerPrice === null ||
    jupiterPrice === null ||
    dexscreenerPrice <= 0 ||
    jupiterPrice <= 0
  ) {
    return {
      dexscreenerPrice,
      jupiterPrice,
      conflict: false,
      maxDeviationPct: null,
    };
  }

  const mid = (dexscreenerPrice + jupiterPrice) / 2;
  const deviationPct = (Math.abs(dexscreenerPrice - jupiterPrice) / mid) * 100;
  const conflict = deviationPct > maxDeviationPct;

  return {
    dexscreenerPrice,
    jupiterPrice,
    conflict,
    maxDeviationPct: deviationPct,
    conflictReason: conflict
      ? `DATA CONFLICT: price deviation ${deviationPct.toFixed(1)}% exceeds ${maxDeviationPct}%`
      : undefined,
  };
}
