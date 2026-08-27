import { DEFAULT_FOREX_RISK, type FxPosition, type FxSide, type RiskSnapshot } from './types';
import { getPair, usdDirection } from './pairs';

export function correlationBlock(
  symbol: string,
  side: FxSide,
  open: FxPosition[],
  maxAbs = DEFAULT_FOREX_RISK.maxAbsCorrelation,
): string | null {
  const spec = getPair(symbol);
  for (const pos of open) {
    if (pos.lotsOpen <= 0) continue;
    const link = spec.correlatedWith.find((c) => c.symbol === pos.symbol);
    const reverse = getPair(pos.symbol).correlatedWith.find((c) => c.symbol === symbol);
    const corr = link?.corr ?? reverse?.corr;
    if (corr == null || Math.abs(corr) < maxAbs) continue;
    const sameWay = corr >= 0 ? side === pos.side : side !== pos.side;
    if (sameWay) {
      return `${symbol} ${side} blocked by ${pos.symbol} ${pos.side} (corr ${corr.toFixed(2)})`;
    }
  }
  return null;
}

export function usdExposureLots(open: FxPosition[]): number {
  return open.reduce((sum, p) => {
    if (p.lotsOpen <= 0) return sum;
    return sum + usdDirection(getPair(p.symbol), p.side) * p.lotsOpen;
  }, 0);
}

export function wouldBreachUsdCap(symbol: string, side: FxSide, lots: number, open: FxPosition[]): boolean {
  const next = usdExposureLots(open) + usdDirection(getPair(symbol), side) * lots;
  return Math.abs(next) > DEFAULT_FOREX_RISK.maxUsdExposureLots;
}

export function drawdownState(opts: {
  balance: number;
  startingBalance: number;
  dailyPnlUsd: number;
  weeklyPnlUsd: number;
}): { dailyDrawdownPct: number; weeklyDrawdownPct: number; dailyHalt: boolean; weeklyHalt: boolean } {
  const dailyDrawdownPct = opts.dailyPnlUsd < 0 ? (Math.abs(opts.dailyPnlUsd) / opts.startingBalance) * 100 : 0;
  const weeklyDrawdownPct = opts.weeklyPnlUsd < 0 ? (Math.abs(opts.weeklyPnlUsd) / opts.startingBalance) * 100 : 0;
  return {
    dailyDrawdownPct,
    weeklyDrawdownPct,
    dailyHalt: dailyDrawdownPct >= DEFAULT_FOREX_RISK.maxDailyLossPct,
    weeklyHalt: weeklyDrawdownPct >= DEFAULT_FOREX_RISK.maxWeeklyLossPct,
  };
}

export function buildRiskSnapshot(opts: {
  balance: number;
  equity: number;
  startingBalance: number;
  dailyPnlUsd: number;
  weeklyPnlUsd: number;
  open: FxPosition[];
  killSwitch: boolean;
  mode: RiskSnapshot['mode'];
  liveBlockedReason: string | null;
}): RiskSnapshot {
  const dd = drawdownState(opts);
  const correlationBlocks = opts.open.flatMap((p) => {
    const others = opts.open.filter((x) => x.id !== p.id);
    const msg = correlationBlock(p.symbol, p.side, others);
    return msg ? [msg] : [];
  });
  return {
    balance: opts.balance,
    equity: opts.equity,
    dailyPnlUsd: opts.dailyPnlUsd,
    weeklyPnlUsd: opts.weeklyPnlUsd,
    dailyDrawdownPct: dd.dailyDrawdownPct,
    weeklyDrawdownPct: dd.weeklyDrawdownPct,
    dailyHalt: dd.dailyHalt,
    weeklyHalt: dd.weeklyHalt,
    openPositions: opts.open.filter((p) => p.lotsOpen > 0).length,
    maxOpen: DEFAULT_FOREX_RISK.maxOpenPositions,
    usdExposureLots: Number(usdExposureLots(opts.open).toFixed(2)),
    correlationBlocks,
    killSwitch: opts.killSwitch,
    mode: opts.mode,
    liveBlockedReason: opts.liveBlockedReason,
  };
}
