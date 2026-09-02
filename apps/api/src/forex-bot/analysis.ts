import { analyzeCandlestickStructure, ema, rsi, type CandlestickStructure } from '@memecoinbot/indicators';
import type { WhyNotBuyItem, WhyNotBuyPanel } from '@memecoinbot/scoring';
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
  const candleStruct = analyzeCandlestickStructure(candles);
  if (candleStruct.notes[0]) reasons.push(`Candles: ${candleStruct.notes.join(', ')}`);

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

function gate(
  key: string,
  label: string,
  passed: boolean,
  blocking: boolean,
  value: string,
  detail: string,
  whyItMatters: string,
  neutral = false,
): WhyNotBuyItem {
  return {
    key,
    label,
    passed,
    blocking,
    status: neutral ? 'NEUTRAL' : passed ? 'PASS' : 'FAIL',
    value,
    detail,
    whyItMatters,
  };
}

export function buildFxWhyNotBuy(opts: {
  analysis: AnalysisResult;
  market: PairMarket;
  candles: CandlestickStructure;
  session: SessionSnapshot;
  requestedSide?: FxSide | null;
}): WhyNotBuyPanel {
  const { analysis, market, candles, session } = opts;
  const quote = market.quote;
  const side = opts.requestedSide ?? analysis.side;
  const feedOk = quote.dataQuality !== 'SYNTHETIC' && !quote.stale;
  const sessionOk = analysis.filtersFailed.every(
    (f) =>
      !f.startsWith('Market closed') &&
      !f.startsWith('Rollover') &&
      !f.startsWith('Session-open') &&
      !f.startsWith('Friday-close') &&
      !f.startsWith('News blackout'),
  );
  const spreadOk = quote.spreadPips <= market.spec.maxSpreadPips;
  const qualityOk = analysis.setupQuality >= DEFAULT_FOREX_RISK.minSetupQuality;
  const rrOk = !analysis.side || analysis.riskReward1 >= DEFAULT_FOREX_RISK.minRiskReward;
  const leanOk = analysis.side != null;
  const sideOk = !side || !analysis.side || side === analysis.side;
  const candleAgrees =
    !side ||
    (side === 'BUY' && candles.bullish) ||
    (side === 'SELL' && !candles.bullish && candles.score <= 48);
  const rsiAgrees =
    analysis.rsi == null
      ? false
      : side === 'SELL'
        ? analysis.rsi >= 45 && analysis.rsi <= 70
        : analysis.rsi >= 30 && analysis.rsi <= 65;
  const trendAgrees = analysis.breakdown.trend >= 16;
  const structureAgrees = analysis.breakdown.structure >= 8;

  const independent = [
    gate(
      'sig_trend',
      'Trend (EMA)',
      trendAgrees,
      false,
      `${analysis.breakdown.trend}/22`,
      analysis.reasons.find((r) => r.includes('trend') || r.includes('EMA')) ?? 'EMA alignment',
      'A buy needs the fast average above the slow average; a sell needs the opposite.',
      analysis.breakdown.trend === 0,
    ),
    gate(
      'sig_rsi',
      'Momentum (RSI)',
      rsiAgrees,
      false,
      analysis.rsi != null ? `RSI ${analysis.rsi.toFixed(0)}` : 'No RSI',
      analysis.rsi == null
        ? 'Need more candles for RSI'
        : analysis.rsi > 70
          ? 'Overbought — chasing longs is how late entries get trapped'
          : analysis.rsi < 30
            ? 'Oversold — chasing shorts is the same trap on the way down'
            : 'RSI is not at an extreme',
      'RSI is one independent read. Overbought/oversold is a reason not to chase, not a green light by itself.',
      analysis.rsi == null,
    ),
    gate(
      'sig_candlestick',
      'Candlestick',
      candleAgrees,
      false,
      `${candles.pattern.replace(/_/g, ' ')} · ${Math.round(candles.score)}/100`,
      candles.notes.join(' · ') || 'No distinctive candle pattern',
      'Same as memecoin: the last candles must support the side. A shooting star is a reason not to buy.',
    ),
    gate(
      'sig_structure',
      'Price structure',
      structureAgrees,
      false,
      `${analysis.breakdown.structure}/12`,
      analysis.reasons.find((r) => /higher-low|lower-high|break of|structure/i.test(r)) ??
        'Structure is only a weak confirmation',
      'Higher lows support longs. Lower highs support shorts. Mixed structure is a reason to wait.',
    ),
    gate(
      'sig_session',
      'Session',
      session.forexOpen && !session.rollover && !session.fridayCloseProtect,
      false,
      session.name,
      session.note,
      'London/New York overlap is the liquid window. Weekend, rollover, and Friday close are reasons not to enter.',
    ),
  ];

  const items: WhyNotBuyItem[] = [
    gate(
      'feed',
      'Price feed',
      feedOk,
      true,
      quote.dataQuality,
      quote.dataQuality === 'SYNTHETIC'
        ? 'Invented candles — will not fill'
        : quote.stale
          ? `Quote ${Math.round(quote.ageMs / 1000)}s old`
          : quote.dataQuality === 'DEGRADED'
            ? 'Yahoo delayed FX is OK for paper, not for live broker fills'
            : `Yahoo ${quote.source}`,
      'Paper uses Yahoo charts. Fake/synthetic prices are a hard no. Live trading still needs a broker tick.',
    ),
    gate(
      'session',
      'Market session',
      sessionOk && session.forexOpen,
      true,
      session.name,
      analysis.filtersFailed.find((f) => /closed|Rollover|Session-open|Friday|News/i.test(f)) ??
        session.note,
      'Do not enter into a closed market, news blackout, or rollover spread spike.',
    ),
    gate(
      'spread',
      'Spread',
      spreadOk,
      true,
      `${quote.spreadPips.toFixed(1)} / max ${market.spec.maxSpreadPips} pips`,
      spreadOk ? 'Inside the pair’s max spread' : 'Spread is too wide to take the setup',
      'A wide spread eats the stop before the idea has a chance.',
    ),
    gate(
      'quality',
      'Setup quality',
      qualityOk,
      true,
      `${analysis.setupQuality} / ${DEFAULT_FOREX_RISK.minSetupQuality}`,
      qualityOk
        ? 'Above the tradeable threshold — still not a win probability'
        : `Quality ${analysis.setupQuality} is below ${DEFAULT_FOREX_RISK.minSetupQuality}`,
      'Quality is how clean the setup is, not the chance it wins. Below the floor is a wait.',
    ),
    gate(
      'rr',
      'Risk / reward',
      rrOk,
      true,
      analysis.side ? `${analysis.riskReward1.toFixed(2)} : 1` : 'n/a',
      rrOk
        ? 'First target is far enough vs the stop'
        : `R:R ${analysis.riskReward1.toFixed(2)} is below ${DEFAULT_FOREX_RISK.minRiskReward}`,
      'If the stop is wide and TP1 is close, skip even when the candles look good.',
    ),
    gate(
      'lean',
      'BUY / SELL lean',
      leanOk && sideOk,
      true,
      `BUY ${analysis.buyPct}% · SELL ${analysis.sellPct}%`,
      !leanOk
        ? 'No side — WAIT. Do not force a buy.'
        : !sideOk
          ? `You tapped ${side} but the live lean is ${analysis.side}`
          : `${analysis.side} lean is the only side this card supports`,
      'Same rule as memecoin: do not buy just because a card exists. The live lean has to match.',
    ),
    ...independent,
  ];

  const blockingFails = items.filter((i) => i.blocking && !i.passed);
  const agreeing = independent.filter((i) => i.passed && i.status !== 'NEUTRAL').length;
  const available = independent.filter((i) => i.status !== 'NEUTRAL').length;
  const canTrade = analysis.tradeable && sideOk && blockingFails.length === 0;
  const decision = !leanOk ? 'WAIT' : !canTrade ? 'NO_TRADE' : analysis.side ?? 'WAIT';
  const verb = side === 'SELL' ? 'sell' : 'buy';

  return {
    title: canTrade ? 'Why This Passed' : 'Why Not Buy',
    decision,
    buyScore: analysis.buyPct,
    safetyScore: analysis.setupQuality,
    agreeing,
    required: 3,
    available,
    summary: canTrade
      ? `Candles + trend + RSI support ${analysis.side}. Still a potential setup only — paper first, never guaranteed.`
      : blockingFails.length
        ? `DO NOT ${verb.toUpperCase()} — tests failed: ${blockingFails.map((f) => f.label).join('; ')}. Taking this trade is how you run a loss.`
        : agreeing < 3
          ? `DO NOT ${verb.toUpperCase()} yet — only ${agreeing} independent reads agree (need 3).`
          : analysis.filtersFailed[0] ?? 'Filters not met.',
    items,
    testsPassed: canTrade,
  };
}

/** Telegram/email only when the pair is actually tradeable — same bar as the in-app BUY button. */
export function shouldAlertFx(row: {
  bias: string;
  buyPct: number;
  sellPct: number;
  tradeable?: boolean;
}): boolean {
  if (!row.tradeable) return false;
  if (row.bias !== 'BUY' && row.bias !== 'SELL') return false;
  const lean = row.bias === 'BUY' ? row.buyPct : row.sellPct;
  return lean >= 60;
}
