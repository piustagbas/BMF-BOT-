export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h';

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14_400,
};

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h'];

export function isTimeframe(value: string | undefined): value is Timeframe {
  return TIMEFRAMES.includes(value as Timeframe);
}

export function timeframeSeconds(tf: Timeframe): number {
  return TIMEFRAME_SECONDS[tf];
}

export type CandleWindow = {
  startMs: number;
  closeMs: number;
  remainingSec: number;
  progress: number;
};

export function currentCandleWindow(tf: Timeframe, nowMs = Date.now()): CandleWindow {
  const sec = TIMEFRAME_SECONDS[tf];
  const nowSec = Math.floor(nowMs / 1000);
  const startSec = nowSec - (nowSec % sec);
  const closeSec = startSec + sec;
  const remainingSec = Math.max(0, closeSec - nowSec);
  return {
    startMs: startSec * 1000,
    closeMs: closeSec * 1000,
    remainingSec,
    progress: Math.min(1, Math.max(0, (nowSec - startSec) / sec)),
  };
}

export type ChartStyle = 'SCALP' | 'MINUTES' | 'HOURS';

export type PickedTimeframes = {
  primary: Timeframe;
  confirm: Timeframe;
  style: ChartStyle;
  reason: string;
};

function abs(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.abs(n);
}

function confirmFor(primary: Timeframe): Timeframe {
  if (primary === '1m') return '5m';
  if (primary === '5m') return '15m';
  if (primary === '15m') return '1h';
  if (primary === '30m') return '1h';
  if (primary === '1h') return '4h';
  return '4h';
}

function styleFor(primary: Timeframe): ChartStyle {
  if (primary === '1m' || primary === '5m') return 'SCALP';
  if (primary === '1h' || primary === '4h') return 'HOURS';
  return 'MINUTES';
}

/**
 * Chart TFs are not a fixed 5m/15m. Fast new coins use faster charts;
 * slower tapes use slower charts. Explicit user TFs always win.
 */
export function pickChartTimeframes(input: {
  pairAgeHours?: number | null;
  priceChangeM5?: number | null;
  priceChangeH1?: number | null;
  priceChange24h?: number | null;
  requestedPrimary?: Timeframe;
  requestedConfirm?: Timeframe;
}): PickedTimeframes {
  if (input.requestedPrimary) {
    const primary = input.requestedPrimary;
    const confirm = input.requestedConfirm ?? confirmFor(primary);
    return {
      primary,
      confirm,
      style: styleFor(primary),
      reason: `You chose ${primary} (confirm ${confirm}).`,
    };
  }

  const age = input.pairAgeHours;
  const m5 = abs(input.priceChangeM5);
  const h1 = abs(input.priceChangeH1);
  const d1 = abs(input.priceChange24h);

  if ((age != null && age < 3) || m5 >= 8 || h1 >= 30) {
    return {
      primary: '1m',
      confirm: '5m',
      style: 'SCALP',
      reason:
        'Very new or vertical tape — using 1m to time the entry and 5m so a 1m spike is not a fakeout.',
    };
  }
  if ((age != null && age < 36) || h1 >= 10 || m5 >= 3) {
    return {
      primary: '5m',
      confirm: '15m',
      style: 'SCALP',
      reason:
        'Typical memecoin pace — using 5m to time the entry and 15m as the trend filter.',
    };
  }
  if (h1 >= 4 || d1 >= 25) {
    return {
      primary: '15m',
      confirm: '1h',
      style: 'MINUTES',
      reason:
        'Slower grind — using 15m entries with 1h confirmation, not a 1m scalp.',
    };
  }
  return {
    primary: '1h',
    confirm: '4h',
    style: 'HOURS',
    reason:
      'Quieter tape — using 1h entries with 4h confirmation so you are not overtrading noise.',
  };
}

export type ChartGuide = {
  primary: Timeframe;
  confirm: Timeframe;
  style: ChartStyle;
  reason: string;
  meaning: string;
  instruction: string;
  candleClosesAt: string;
  confirmClosesAt: string;
  entryWindowEndsAt: string;
  waitForClose: boolean;
};

export function buildChartGuide(
  picked: PickedTimeframes,
  nowMs = Date.now(),
): ChartGuide {
  const primaryWin = currentCandleWindow(picked.primary, nowMs);
  const confirmWin = currentCandleWindow(picked.confirm, nowMs);
  const entryWindowEndsAt = new Date(
    primaryWin.closeMs + TIMEFRAME_SECONDS[picked.primary] * 1000,
  ).toISOString();
  const waitForClose = primaryWin.remainingSec > 12;

  const meaning =
    `Follow ${picked.primary} means open that candlestick chart — each candle is ${picked.primary}, and that is the clock for this trade. ` +
    `Confirm on ${picked.confirm} means the higher timeframe should still look bullish; if ${picked.confirm} is dumping, a ${picked.primary} bounce is often a fakeout.`;

  const instruction = waitForClose
    ? `WAIT — do not buy mid-candle. Let the current ${picked.primary} candle close first, then enter only if price is still in the entry range.`
    : `ENTRY WINDOW — the ${picked.primary} candle is closing / just closed. Enter only while price stays inside the entry range. When the window ends, refresh before buying.`;

  return {
    primary: picked.primary,
    confirm: picked.confirm,
    style: picked.style,
    reason: picked.reason,
    meaning,
    instruction,
    candleClosesAt: new Date(primaryWin.closeMs).toISOString(),
    confirmClosesAt: new Date(confirmWin.closeMs).toISOString(),
    entryWindowEndsAt,
    waitForClose,
  };
}
