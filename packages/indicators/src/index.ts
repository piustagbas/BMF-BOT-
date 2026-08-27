import type { Timeframe } from './timeframes';

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export {
  TIMEFRAME_SECONDS,
  TIMEFRAMES,
  isTimeframe,
  timeframeSeconds,
  currentCandleWindow,
  pickChartTimeframes,
  buildChartGuide,
  type Timeframe,
  type CandleWindow,
  type ChartGuide,
  type ChartStyle,
  type PickedTimeframes,
} from './timeframes';

export function ema(values: number[], period: number): Array<number | null> {
  if (period <= 0) throw new Error('EMA period must be > 0');
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return out;

  const k = 2 / (period + 1);
  let prev =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function rsi(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function vwap(candles: Candle[]): Array<number | null> {
  const out: Array<number | null> = Array(candles.length).fill(null);
  let cumPv = 0;
  let cumVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const typical = (c.high + c.low + c.close) / 3;
    cumPv += typical * c.volume;
    cumVol += c.volume;
    out[i] = cumVol > 0 ? cumPv / cumVol : null;
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): {
  macd: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
} {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine: Array<number | null> = values.map((_, i) => {
    if (fastEma[i] == null || slowEma[i] == null) return null;
    return fastEma[i]! - slowEma[i]!;
  });

  const macdValues = macdLine.map((v) => v ?? NaN);
  // Build signal only on defined macd points — use sequential defined values
  const definedIdx: number[] = [];
  const definedVals: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null) {
      definedIdx.push(i);
      definedVals.push(macdLine[i]!);
    }
  }
  const signalOnDefined = ema(definedVals, signalPeriod);
  const signal: Array<number | null> = Array(values.length).fill(null);
  for (let j = 0; j < definedIdx.length; j++) {
    signal[definedIdx[j]!] = signalOnDefined[j] ?? null;
  }

  const histogram = macdLine.map((v, i) =>
    v == null || signal[i] == null ? null : v - signal[i]!,
  );

  void macdValues;
  return { macd: macdLine, signal, histogram };
}

export function atr(candles: Candle[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(candles.length).fill(null);
  if (candles.length === 0) return out;

  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (i === 0) {
      trs.push(c.high - c.low);
    } else {
      const prev = candles[i - 1]!;
      trs.push(
        Math.max(
          c.high - c.low,
          Math.abs(c.high - prev.close),
          Math.abs(c.low - prev.close),
        ),
      );
    }
  }

  if (trs.length < period) return out;
  let sum = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]!) / period;
    out[i] = prev;
  }
  return out;
}

export function volumeMovingAverage(
  candles: Candle[],
  period = 20,
): Array<number | null> {
  return sma(
    candles.map((c) => c.volume),
    period,
  );
}

export type SwingPoint = { index: number; price: number };

export function findSwingHighs(candles: Candle[], left = 2, right = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const price = candles[i]!.high;
    let isSwing = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= price) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) swings.push({ index: i, price });
  }
  return swings;
}

export function findSwingLows(candles: Candle[], left = 2, right = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const price = candles[i]!.low;
    let isSwing = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j]!.low <= price) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) swings.push({ index: i, price });
  }
  return swings;
}

export function detectStructure(candles: Candle[]): {
  higherHighs: boolean;
  higherLows: boolean;
  lowerHighs: boolean;
  lowerLows: boolean;
  support: number | null;
  resistance: number | null;
  trend: 'BULLISH' | 'BEARISH' | 'RANGE';
} {
  const highs = findSwingHighs(candles);
  const lows = findSwingLows(candles);
  const lastHighs = highs.slice(-3);
  const lastLows = lows.slice(-3);

  const higherHighs =
    lastHighs.length >= 2 &&
    lastHighs[lastHighs.length - 1]!.price > lastHighs[lastHighs.length - 2]!.price;
  const lowerHighs =
    lastHighs.length >= 2 &&
    lastHighs[lastHighs.length - 1]!.price < lastHighs[lastHighs.length - 2]!.price;
  const higherLows =
    lastLows.length >= 2 &&
    lastLows[lastLows.length - 1]!.price > lastLows[lastLows.length - 2]!.price;
  const lowerLows =
    lastLows.length >= 2 &&
    lastLows[lastLows.length - 1]!.price < lastLows[lastLows.length - 2]!.price;

  const support = lastLows.length ? lastLows[lastLows.length - 1]!.price : null;
  const resistance = lastHighs.length
    ? lastHighs[lastHighs.length - 1]!.price
    : null;

  let trend: 'BULLISH' | 'BEARISH' | 'RANGE' = 'RANGE';
  if (higherHighs && higherLows) trend = 'BULLISH';
  else if (lowerHighs && lowerLows) trend = 'BEARISH';

  return {
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
    support,
    resistance,
    trend,
  };
}

export function detectBreakout(
  candles: Candle[],
  lookback = 20,
): {
  breakout: boolean;
  breakdown: boolean;
  level: number | null;
} {
  if (candles.length < lookback + 1) {
    return { breakout: false, breakdown: false, level: null };
  }
  const window = candles.slice(-lookback - 1, -1);
  const level = Math.max(...window.map((c) => c.high));
  const floor = Math.min(...window.map((c) => c.low));
  const last = candles[candles.length - 1]!;
  return {
    breakout: last.close > level,
    breakdown: last.close < floor,
    level,
  };
}

export function detectBreakoutRetest(
  candles: Candle[],
  lookback = 20,
  tolerancePct = 1.5,
): boolean {
  if (candles.length < lookback + 5) return false;
  const prior = candles.slice(0, -3);
  const br = detectBreakout(prior, lookback);
  if (!br.breakout || br.level == null) return false;
  const recent = candles.slice(-3);
  const retested = recent.some((c) => {
    const dist = Math.abs(c.low - br.level!) / br.level! * 100;
    return dist <= tolerancePct && c.close >= br.level!;
  });
  const holding = candles[candles.length - 1]!.close >= br.level!;
  return retested && holding;
}

export {
  analyzeCandlestickStructure,
  type CandlePattern,
  type CandlestickStructure,
} from './candlesticks';

export function lastDefined(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return values[i]!;
  }
  return null;
}

export type IndicatorSnapshot = {
  timeframe: Timeframe;
  price: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  vwap: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr: number | null;
  volumeMa: number | null;
  volume: number | null;
  support: number | null;
  resistance: number | null;
  trend: 'BULLISH' | 'BEARISH' | 'RANGE';
  higherHighs: boolean;
  higherLows: boolean;
  lowerHighs: boolean;
  lowerLows: boolean;
  breakout: boolean;
  breakoutRetest: boolean;
  bullishEmaStack: boolean;
  aboveVwap: boolean;
  volumeExpansion: boolean;
};

export function buildIndicatorSnapshot(
  candles: Candle[],
  timeframe: Timeframe,
): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const vw = vwap(candles);
  const rsiVals = rsi(closes, 14);
  const macdVals = macd(closes);
  const atrVals = atr(candles, 14);
  const volMa = volumeMovingAverage(candles, 20);
  const structure = detectStructure(candles);
  const br = detectBreakout(candles, 20);
  const last = candles[candles.length - 1];
  const e9 = lastDefined(ema9);
  const e21 = lastDefined(ema21);
  const e50 = lastDefined(ema50);
  const v = lastDefined(vw);
  const price = last?.close ?? null;
  const volume = last?.volume ?? null;
  const volumeMaLast = lastDefined(volMa);

  return {
    timeframe,
    price,
    ema9: e9,
    ema21: e21,
    ema50: e50,
    vwap: v,
    rsi: lastDefined(rsiVals),
    macd: lastDefined(macdVals.macd),
    macdSignal: lastDefined(macdVals.signal),
    macdHistogram: lastDefined(macdVals.histogram),
    atr: lastDefined(atrVals),
    volumeMa: volumeMaLast,
    volume,
    support: structure.support,
    resistance: structure.resistance,
    trend: structure.trend,
    higherHighs: structure.higherHighs,
    higherLows: structure.higherLows,
    lowerHighs: structure.lowerHighs,
    lowerLows: structure.lowerLows,
    breakout: br.breakout,
    breakoutRetest: detectBreakoutRetest(candles),
    bullishEmaStack:
      e9 != null && e21 != null && e50 != null && e9 > e21 && e21 > e50,
    aboveVwap: price != null && v != null && price > v,
    volumeExpansion:
      volume != null && volumeMaLast != null && volume > volumeMaLast * 1.5,
  };
}
