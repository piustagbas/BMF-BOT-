import { ema, rsi } from '@memecoinbot/indicators';
import {
  DEFAULT_FOREX_RISK,
  type CalibratedConfidence,
  type EntryZone,
  type FxBias,
  type FxCandle,
  type FxSide,
  type ScoreBreakdown,
  type SessionSnapshot,
} from './types';
import { pipsBetween, roundPrice } from './pairs';
import type { PairMarket } from './market';

export type AnalysisResult = {
  tradeable: boolean;
  bias: FxBias;
  side: FxSide | null;
  zone: EntryZone | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  stopPips: number;
  tp1Pips: number;
  tp2Pips: number;
  riskReward1: number;
  breakdown: ScoreBreakdown;
  setupQuality: number;
  buyPct: number;
  sellPct: number;
  rsi: number | null;
  changePct: number;
  changePips: number;
  confidence: CalibratedConfidence;
  reasons: string[];
  filtersFailed: string[];
};

export function calibrateScore(setupQuality: number): CalibratedConfidence {
  const q = Math.max(0, Math.min(100, Math.round(setupQuality)));
  const warning =
    'Setup quality is not a win probability. A 90/100 score does not mean a 90% chance of profit.';
  if (q < 60) {
    return {
      setupQuality: q,
      estimatedHitRateLowPct: null,
      estimatedHitRateHighPct: null,
      sampleNote: 'Below tradeable threshold — no calibrated hit-rate band.',
      warning,
    };
  }
  const bands: Array<[number, number, number]> = [
    [90, 54, 60],
    [80, 52, 58],
    [70, 50, 56],
    [60, 48, 54],
  ];
  const band = bands.find(([min]) => q >= min) ?? [60, 48, 54];
  return {
    setupQuality: q,
    estimatedHitRateLowPct: band[1],
    estimatedHitRateHighPct: band[2],
    sampleNote: `Historical band for similar scores is about ${band[1]}–${band[2]}% (not a forecast; sample-limited).`,
    warning,
  };
}

export function analyzePair(
  market: PairMarket,
  session: SessionSnapshot,
  timeFilters: string[],
): AnalysisResult {
  const failed = [...timeFilters];
  const spec = market.spec;
  const quote = market.quote;
  const candles = market.candles;
  const closes = candles.map((c) => c.close);
  const ema20 = last(ema(closes, 20));
  const ema50 = last(ema(closes, 50));
  const rsi14 = last(rsi(closes, 14));
  const atrVal = market.atr;
  const mid = quote.mid;
  const reasons: string[] = [];
  const change = changeFromCandles(candles, mid, spec.pipSize);

  if (quote.stale) failed.push(`Stale quote (${Math.round(quote.ageMs / 1000)}s old)`);
  if (quote.dataQuality === 'SYNTHETIC') failed.push('Synthetic prices — live validation failed');
  if (quote.spreadPips > spec.maxSpreadPips) {
    failed.push(`Spread ${quote.spreadPips.toFixed(1)} pips exceeds max ${spec.maxSpreadPips}`);
  }
  if (market.spike) failed.push('News-spike detected (range > 2.5× ATR)');
  if (candles.length < 30) failed.push('Limited candle history');
  if (atrVal == null || atrVal <= 0) failed.push('ATR unavailable');

  let buyPct = 50;
  let sellPct = 50;
  let trendScore = 0;
  if (ema20 != null && ema50 != null) {
    const gap = (ema20 - ema50) / spec.pipSize;
    const priceVsFast = (mid - ema20) / spec.pipSize;
    buyPct = clamp(
      50 + gap * 0.8 + priceVsFast * 0.35 + (rsi14 != null ? (50 - rsi14) * 0.35 : 0),
      8,
      92,
    );
    sellPct = 100 - buyPct;
    if (ema20 > ema50 && mid >= ema20) {
      trendScore = 22;
      reasons.push('Uptrend: EMA20 above EMA50, price holding the fast average');
    } else if (ema20 < ema50 && mid <= ema20) {
      trendScore = 22;
      reasons.push('Downtrend: EMA20 below EMA50, price holding the fast average');
    } else {
      trendScore = 8;
      reasons.push('EMAs mixed — no clean trend');
    }
  } else {
    reasons.push('Waiting on enough candles for EMA');
  }

  let pullback = 0;
  if (rsi14 != null) {
    if (rsi14 >= 40 && rsi14 <= 60) {
      pullback = 12;
      reasons.push(`RSI mid-range (${rsi14.toFixed(0)})`);
    } else if (rsi14 > 70) {
      pullback = 4;
      buyPct = Math.min(buyPct, 42);
      sellPct = 100 - buyPct;
      reasons.push(`RSI overbought (${rsi14.toFixed(0)}) — avoid chasing longs`);
    } else if (rsi14 < 30) {
      pullback = 4;
      sellPct = Math.min(sellPct, 42);
      buyPct = 100 - sellPct;
      reasons.push(`RSI oversold (${rsi14.toFixed(0)}) — avoid chasing shorts`);
    } else {
      pullback = 7;
      reasons.push(`RSI ${rsi14.toFixed(0)}`);
    }
  }

  const bias: FxBias = buyPct >= 58 ? 'BUY' : sellPct >= 58 ? 'SELL' : 'WAIT';
  const side: FxSide | null = bias === 'WAIT' ? null : bias;
  const structure = structureScore(candles, side);
  if (structure.note) reasons.push(structure.note);

  let zone: EntryZone | null = null;
  let stopLoss: number | null = null;
  let takeProfit1: number | null = null;
  let takeProfit2: number | null = null;
  let stopPips = 0;
  let tp1Pips = 0;
  let tp2Pips = 0;
  let riskReward1 = 0;
  if (side && atrVal && atrVal > 0) {
    const stopDist = atrVal * 1.5;
    stopLoss = roundPrice(spec, side === 'BUY' ? mid - stopDist : mid + stopDist);
    takeProfit1 = roundPrice(spec, side === 'BUY' ? mid + stopDist : mid - stopDist);
    takeProfit2 = roundPrice(spec, side === 'BUY' ? mid + stopDist * 2 : mid - stopDist * 2);
    const zoneWidth = atrVal * 0.25;
    zone = {
      low: roundPrice(spec, mid - zoneWidth),
      high: roundPrice(spec, mid + zoneWidth),
      mid: roundPrice(spec, mid),
      widthPips: pipsBetween(spec, mid - zoneWidth, mid + zoneWidth),
    };
    stopPips = pipsBetween(spec, mid, stopLoss);
    tp1Pips = pipsBetween(spec, mid, takeProfit1);
    tp2Pips = pipsBetween(spec, mid, takeProfit2);
    riskReward1 = stopPips > 0 ? tp1Pips / stopPips : 0;
    if (riskReward1 < DEFAULT_FOREX_RISK.minRiskReward) failed.push(`R:R ${riskReward1.toFixed(2)} below minimum`);
  }

  if (!side) failed.push('No BUY/SELL lean — WAIT');
  const reward = Math.min(15, riskReward1 >= 2 ? 15 : riskReward1 >= 1.5 ? 12 : 6);
  const spreadScore =
    quote.spreadPips <= spec.typicalSpreadPips ? 10 : quote.spreadPips <= spec.maxSpreadPips * 0.7 ? 6 : 3;
  const sessionScore = sessionScoreFor(session);
  const freshness = quote.dataQuality === 'LIVE' ? 10 : quote.dataQuality === 'DEGRADED' ? 4 : 0;
  const breakdown: ScoreBreakdown = {
    trend: trendScore,
    pullback,
    structure: structure.score,
    reward: side ? reward : 0,
    spread: spreadScore,
    session: sessionScore,
    freshness,
    total: 0,
  };
  breakdown.total = Math.min(
    100,
    breakdown.trend +
      breakdown.pullback +
      breakdown.structure +
      breakdown.reward +
      breakdown.spread +
      breakdown.session +
      breakdown.freshness,
  );
  const setupQuality = breakdown.total;
  if (setupQuality < DEFAULT_FOREX_RISK.minSetupQuality) {
    failed.push(`Setup quality ${setupQuality} below ${DEFAULT_FOREX_RISK.minSetupQuality}`);
  }
  if (quote.dataQuality !== 'LIVE') {
    failed.push('Feed is not a live tick — paper fill still rechecks before execute');
  }

  return {
    tradeable:
      failed.length === 0 && !!side && !!zone && setupQuality >= DEFAULT_FOREX_RISK.minSetupQuality,
    bias,
    side,
    zone,
    stopLoss,
    takeProfit1,
    takeProfit2,
    stopPips,
    tp1Pips,
    tp2Pips,
    riskReward1,
    breakdown,
    setupQuality,
    buyPct: Math.round(buyPct),
    sellPct: Math.round(sellPct),
    rsi: rsi14,
    changePct: change.pct,
    changePips: change.pips,
    confidence: calibrateScore(setupQuality),
    reasons,
    filtersFailed: failed,
  };
}

function changeFromCandles(candles: FxCandle[], mid: number, pipSize: number): { pct: number; pips: number } {
  const ref = candles.length >= 2 ? candles[Math.max(0, candles.length - 96)]!.close : candles[0]?.close ?? mid;
  if (!ref) return { pct: 0, pips: 0 };
  return {
    pct: Number((((mid - ref) / ref) * 100).toFixed(3)),
    pips: Number(((mid - ref) / pipSize).toFixed(1)),
  };
}

function sessionScoreFor(session: SessionSnapshot): number {
  if (!session.forexOpen) return 0;
  if (session.rollover || session.sessionOpenProtect || session.fridayCloseProtect) return 2;
  if (session.name === 'LONDON' || session.name === 'NEW_YORK') return 10;
  if (session.name === 'TOKYO') return 7;
  return 5;
}

function structureScore(candles: FxCandle[], side: FxSide | null): { ok: boolean; score: number; note: string } {
  if (!side || candles.length < 8) return { ok: false, score: 4, note: 'Limited structure sample' };
  const slice = candles.slice(-8);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const hh = highs[highs.length - 1]! >= Math.max(...highs.slice(0, -1));
  const hl = lows[lows.length - 1]! >= Math.min(...lows.slice(0, -3));
  const ll = lows[lows.length - 1]! <= Math.min(...lows.slice(0, -1));
  const lh = highs[highs.length - 1]! <= Math.max(...highs.slice(0, -3));
  if (side === 'BUY' && hl) return { ok: true, score: 12, note: 'Higher-low structure supports longs' };
  if (side === 'SELL' && lh) return { ok: true, score: 12, note: 'Lower-high structure supports shorts' };
  if (side === 'BUY' && hh) return { ok: true, score: 8, note: 'Break of recent high' };
  if (side === 'SELL' && ll) return { ok: true, score: 8, note: 'Break of recent low' };
  return { ok: true, score: 5, note: 'Structure is only a weak confirmation' };
}

function last(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return v;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function inEntryZone(price: number, zone: EntryZone): boolean {
  return price >= zone.low && price <= zone.high;
}

export function signalExpired(expiresAt: string, now = new Date()): boolean {
  return now.toISOString() > expiresAt;
}

export function dedupeKey(symbol: string, side: FxSide, zone: EntryZone, dayKey: string): string {
  const bucket = Math.round(zone.mid * 10_000);
  return `${symbol}|${side}|${bucket}|${dayKey}`;
}
