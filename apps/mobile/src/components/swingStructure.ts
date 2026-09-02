export type ChartSwingCandle = {
  high: number;
  low: number;
  close: number;
};

export type SwingKind = 'HH' | 'HL' | 'LH' | 'LL' | 'H' | 'L';

export type SwingPoint = {
  index: number;
  price: number;
  kind: SwingKind;
  type: 'high' | 'low';
};

export type SwingOutlook = {
  trend: 'UP' | 'DOWN' | 'RANGE' | 'UNKNOWN';
  last: SwingKind | null;
  nextKind: 'HH' | 'HL' | 'LH' | 'LL' | null;
  nextPrice: number | null;
  confirm: 'BUY' | 'SELL' | 'WAIT';
  confirmNote: string;
  points: SwingPoint[];
};

function isSwingHigh(candles: ChartSwingCandle[], i: number, lookback: number): boolean {
  const h = candles[i]!.high;
  for (let k = 1; k <= lookback; k++) {
    const left = candles[i - k];
    const right = candles[i + k];
    if (!left || !right) return false;
    if (h < left.high || h < right.high) return false;
  }
  return true;
}

function isSwingLow(candles: ChartSwingCandle[], i: number, lookback: number): boolean {
  const l = candles[i]!.low;
  for (let k = 1; k <= lookback; k++) {
    const left = candles[i - k];
    const right = candles[i + k];
    if (!left || !right) return false;
    if (l > left.low || l > right.low) return false;
  }
  return true;
}

export function detectSwingStructure(candles: ChartSwingCandle[], lookback = 3): SwingOutlook {
  const empty: SwingOutlook = {
    trend: 'UNKNOWN',
    last: null,
    nextKind: null,
    nextPrice: null,
    confirm: 'WAIT',
    confirmNote: 'Need more candles to map higher-high / higher-low structure.',
    points: [],
  };
  if (candles.length < lookback * 2 + 3) return empty;

  const raw: Array<{ index: number; price: number; type: 'high' | 'low' }> = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const high = isSwingHigh(candles, i, lookback);
    const low = isSwingLow(candles, i, lookback);
    if (high) raw.push({ index: i, price: candles[i]!.high, type: 'high' });
    if (low && !high) raw.push({ index: i, price: candles[i]!.low, type: 'low' });
  }

  const points: SwingPoint[] = [];
  let prevHigh: number | null = null;
  let prevLow: number | null = null;
  for (const s of raw) {
    if (s.type === 'high') {
      const kind: SwingKind = prevHigh == null ? 'H' : s.price > prevHigh ? 'HH' : 'LH';
      points.push({ ...s, kind });
      prevHigh = s.price;
    } else {
      const kind: SwingKind = prevLow == null ? 'L' : s.price > prevLow ? 'HL' : 'LL';
      points.push({ ...s, kind });
      prevLow = s.price;
    }
  }

  const labeled = points.filter((p) => p.kind !== 'H' && p.kind !== 'L');
  const highs = labeled.filter((p) => p.type === 'high');
  const lows = labeled.filter((p) => p.type === 'low');
  const lastHigh = highs[highs.length - 1] ?? null;
  const lastLow = lows[lows.length - 1] ?? null;
  const last = labeled[labeled.length - 1] ?? points[points.length - 1] ?? null;

  const bullish = lastHigh?.kind === 'HH' && lastLow?.kind === 'HL';
  const bearish = lastHigh?.kind === 'LH' && lastLow?.kind === 'LL';
  const trend: SwingOutlook['trend'] = bullish ? 'UP' : bearish ? 'DOWN' : labeled.length >= 2 ? 'RANGE' : 'UNKNOWN';

  const close = candles[candles.length - 1]!.close;
  let nextKind: SwingOutlook['nextKind'] = null;
  let nextPrice: number | null = null;
  let confirm: SwingOutlook['confirm'] = 'WAIT';
  let confirmNote = 'Wait for a clean HH+HL (buy) or LH+LL (sell) sequence.';

  const lastKind = last?.kind && last.kind !== 'H' && last.kind !== 'L' ? last.kind : null;

  if (lastKind === 'HH') {
    nextKind = 'HL';
    nextPrice = lastLow && lastHigh ? (lastLow.price + lastHigh.price) / 2 : lastHigh ? lastHigh.price * 0.997 : null;
    confirmNote =
      'Last swing is a higher high. Do not chase. Next: a higher low. BUY only if that HL holds, then price breaks this HH.';
  } else if (lastKind === 'HL') {
    nextKind = 'HH';
    nextPrice = lastHigh ? lastHigh.price + Math.abs(lastHigh.price - (lastLow?.price ?? lastHigh.price * 0.99)) * 0.35 : close;
    if (lastHigh && close > lastHigh.price && trend === 'UP') {
      confirm = 'BUY';
      confirmNote = 'Higher low held and price took the last higher high — that confirms a BUY continuation.';
    } else {
      confirmNote =
        'Last swing is a higher low. Next: another higher high. BUY confirms if this HL holds and price breaks the last HH.';
    }
  } else if (lastKind === 'LH') {
    nextKind = 'LL';
    nextPrice = lastHigh && lastLow ? (lastHigh.price + lastLow.price) / 2 : lastHigh ? lastHigh.price * 1.003 : null;
    confirmNote =
      'Last swing is a lower high. Next: a lower low. SELL confirms if this LH rejects and price breaks the last LL.';
  } else if (lastKind === 'LL') {
    nextKind = 'LH';
    nextPrice = lastLow ? lastLow.price - Math.abs((lastHigh?.price ?? close) - lastLow.price) * 0.35 : close;
    if (lastLow && close < lastLow.price && trend === 'DOWN') {
      confirm = 'SELL';
      confirmNote = 'Lower high held and price took the last lower low — that confirms a SELL continuation.';
    } else {
      confirmNote =
        'Last swing is a lower low. Next: a lower high. SELL confirms if that LH rejects, then price breaks this LL.';
    }
  } else if (trend === 'UP') {
    nextKind = lastKind === 'HH' ? 'HL' : 'HH';
    confirmNote = 'Uptrend (HH + HL). Next higher low, then break last HH to confirm BUY.';
  } else if (trend === 'DOWN') {
    nextKind = lastKind === 'LL' ? 'LH' : 'LL';
    confirmNote = 'Downtrend (LH + LL). Next lower high, then break last LL to confirm SELL.';
  }

  if (confirm === 'WAIT' && trend === 'UP' && lastKind === 'HL') {
    confirmNote = `Uptrend. Expect HH next. BUY if price holds ${formatSwing(lastLow?.price)} and breaks ${formatSwing(lastHigh?.price)}.`;
  }
  if (confirm === 'WAIT' && trend === 'DOWN' && lastKind === 'LH') {
    confirmNote = `Downtrend. Expect LL next. SELL if price rejects ${formatSwing(lastHigh?.price)} and breaks ${formatSwing(lastLow?.price)}.`;
  }

  const draw = points.slice(-8);
  return {
    trend,
    last: lastKind,
    nextKind,
    nextPrice,
    confirm,
    confirmNote,
    points: draw,
  };
}

function formatSwing(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'the last swing';
  if (n >= 1) return n.toPrecision(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(4);
}
