type Candle = {
  time?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type CandlePattern =
  | 'BULLISH_ENGULFING'
  | 'BEARISH_ENGULFING'
  | 'HAMMER'
  | 'SHOOTING_STAR'
  | 'DOJI'
  | 'BULLISH_MARUBOZU'
  | 'BEARISH_MARUBOZU'
  | 'NONE';

export type CandlestickStructure = {
  pattern: CandlePattern;
  consecutiveBullish: number;
  consecutiveBearish: number;
  closeLocation: 'HIGH' | 'MID' | 'LOW';
  bullish: boolean;
  notes: string[];
  score: number;
};

function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function range(c: Candle): number {
  return Math.max(c.high - c.low, 1e-12);
}

function isGreen(c: Candle): boolean {
  return c.close >= c.open;
}

function upperWick(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function detectPattern(prev: Candle | undefined, last: Candle): CandlePattern {
  const b = body(last);
  const r = range(last);
  const uw = upperWick(last);
  const lw = lowerWick(last);

  if (b / r < 0.12) return 'DOJI';

  if (prev) {
    const prevGreen = isGreen(prev);
    const lastGreen = isGreen(last);
    if (
      !prevGreen &&
      lastGreen &&
      last.open <= prev.close &&
      last.close >= prev.open &&
      body(last) > body(prev)
    ) {
      return 'BULLISH_ENGULFING';
    }
    if (
      prevGreen &&
      !lastGreen &&
      last.open >= prev.close &&
      last.close <= prev.open &&
      body(last) > body(prev)
    ) {
      return 'BEARISH_ENGULFING';
    }
  }

  if (lw >= b * 2 && uw <= b * 0.6 && last.close > last.low + r * 0.55) {
    return 'HAMMER';
  }
  if (uw >= b * 2 && lw <= b * 0.6 && last.close < last.high - r * 0.55) {
    return 'SHOOTING_STAR';
  }
  if (b / r >= 0.72) {
    return isGreen(last) ? 'BULLISH_MARUBOZU' : 'BEARISH_MARUBOZU';
  }
  return 'NONE';
}

export function analyzeCandlestickStructure(candles: Candle[]): CandlestickStructure {
  if (candles.length === 0) {
    return {
      pattern: 'NONE',
      consecutiveBullish: 0,
      consecutiveBearish: 0,
      closeLocation: 'MID',
      bullish: false,
      notes: ['No candles'],
      score: 0,
    };
  }

  const last = candles[candles.length - 1]!;
  const prev = candles.length >= 2 ? candles[candles.length - 2] : undefined;
  const pattern = detectPattern(prev, last);

  let consecutiveBullish = 0;
  let consecutiveBearish = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i]!;
    if (isGreen(c)) {
      if (consecutiveBearish > 0) break;
      consecutiveBullish += 1;
    } else {
      if (consecutiveBullish > 0) break;
      consecutiveBearish += 1;
    }
    if (consecutiveBullish + consecutiveBearish >= 8) break;
  }

  const locRatio = (last.close - last.low) / range(last);
  const closeLocation: CandlestickStructure['closeLocation'] =
    locRatio >= 0.66 ? 'HIGH' : locRatio <= 0.33 ? 'LOW' : 'MID';

  const notes: string[] = [];
  let score = 48;

  if (pattern !== 'NONE') notes.push(pattern.replace(/_/g, ' ').toLowerCase());

  switch (pattern) {
    case 'BULLISH_ENGULFING':
      score += 22;
      break;
    case 'HAMMER':
      score += 16;
      break;
    case 'BULLISH_MARUBOZU':
      score += 12;
      break;
    case 'DOJI':
      score -= 4;
      notes.push('Indecision candle');
      break;
    case 'SHOOTING_STAR':
      score -= 18;
      break;
    case 'BEARISH_ENGULFING':
      score -= 22;
      break;
    case 'BEARISH_MARUBOZU':
      score -= 14;
      break;
    default:
      break;
  }

  if (consecutiveBullish >= 3) {
    score += 10;
    notes.push(`${consecutiveBullish} green candles`);
  } else if (consecutiveBullish === 2) {
    score += 5;
  }
  if (consecutiveBearish >= 3) {
    score -= 12;
    notes.push(`${consecutiveBearish} red candles`);
  }

  if (closeLocation === 'HIGH') {
    score += 8;
    notes.push('Close near high');
  } else if (closeLocation === 'LOW') {
    score -= 10;
    notes.push('Close near low');
  }

  const bullish =
    score >= 60 ||
    pattern === 'BULLISH_ENGULFING' ||
    pattern === 'HAMMER' ||
    (consecutiveBullish >= 2 && closeLocation === 'HIGH');

  if (notes.length === 0) notes.push('No distinctive candle pattern');

  return {
    pattern,
    consecutiveBullish,
    consecutiveBearish,
    closeLocation,
    bullish,
    notes,
    score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)),
  };
}
