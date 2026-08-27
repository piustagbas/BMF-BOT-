import {
  DEFAULT_FOREX_RISK,
  type FxMode,
  type FxPosition,
  type FxQuote,
  type FxSignal,
  type FxSide,
  type PipelineStep,
  type ProtectRules,
} from './types';
import { analyzePair, inEntryZone, signalExpired } from './analysis';
import { getPair, pnlUsd, pipsBetween, roundPrice } from './pairs';
import type { PairMarket } from './market';
import { isQuoteStale } from './market';
import { sessionSnapshot, filterReasonsForTime } from './calendar';

export type RecheckResult = {
  ok: boolean;
  blockers: string[];
  quote: FxQuote | null;
  stillInZone: boolean;
  spreadPips: number | null;
  slippagePips: number | null;
};

export function step(stage: PipelineStep['stage'], ok: boolean, note: string, at = new Date()): PipelineStep {
  return { stage, ok, at: at.toISOString(), note };
}

export function recheckLive(opts: {
  signal: FxSignal;
  market: PairMarket;
  now?: Date;
  requestedSide: FxSide;
}): RecheckResult {
  const now = opts.now ?? new Date();
  const blockers: string[] = [];
  const quote = opts.market.quote;
  if (opts.requestedSide !== opts.signal.side) blockers.push('Clicked side does not match the setup');
  if (signalExpired(opts.signal.expiresAt, now)) blockers.push('Signal expired — revalidation failed');
  if (isQuoteStale(quote, now.getTime())) blockers.push('Quote is stale — refusing execution');
  if (quote.dataQuality !== 'LIVE') blockers.push(`Feed quality ${quote.dataQuality} — live tick required`);
  const fill = opts.requestedSide === 'BUY' ? quote.ask : quote.bid;
  const stillInZone = inEntryZone(fill, opts.signal.zone);
  if (!stillInZone) blockers.push('Price left the entry zone');
  if (quote.spreadPips > opts.market.spec.maxSpreadPips) {
    blockers.push(`Spread ${quote.spreadPips.toFixed(1)} above max ${opts.market.spec.maxSpreadPips}`);
  }
  const slippagePips = pipsBetween(opts.market.spec, opts.signal.zone.mid, fill);
  if (slippagePips > DEFAULT_FOREX_RISK.maxSlippagePips) {
    blockers.push(`Slippage ${slippagePips.toFixed(1)} pips above max ${DEFAULT_FOREX_RISK.maxSlippagePips}`);
  }
  const timeFilters = filterReasonsForTime(now, opts.market.spec);
  blockers.push(...timeFilters);
  const analysis = analyzePair(opts.market, sessionSnapshot(now), timeFilters);
  if (!analysis.tradeable || analysis.side !== opts.signal.side) {
    blockers.push('Setup failed re-analysis on live data');
  }
  return {
    ok: blockers.length === 0,
    blockers: unique(blockers),
    quote,
    stillInZone,
    spreadPips: quote.spreadPips,
    slippagePips,
  };
}

export function brokerExecutionChecks(opts: {
  mode: FxMode;
  killSwitch: boolean;
  liveBlockedReason: string | null;
  quote: FxQuote;
}): string[] {
  const blockers: string[] = [];
  if (opts.killSwitch) blockers.push('Kill switch is ON');
  if (opts.mode === 'LIVE') {
    blockers.push(opts.liveBlockedReason ?? 'Live broker adapter is not connected');
  }
  if (opts.quote.stale) blockers.push('Broker quote stale');
  return blockers;
}

export function openProtectedPosition(opts: {
  signal: FxSignal;
  fill: number;
  lots: number;
  mode: FxMode;
  atr: number;
  now?: Date;
}): FxPosition {
  const now = opts.now ?? new Date();
  const spec = getPair(opts.signal.symbol);
  const protect: ProtectRules = {
    sl: opts.signal.stopLoss,
    tp1: opts.signal.takeProfit1,
    tp2: opts.signal.takeProfit2,
    tp1ClosePct: DEFAULT_FOREX_RISK.tp1ClosePct,
    tp2ClosePct: DEFAULT_FOREX_RISK.tp2ClosePct,
    remainderPct: DEFAULT_FOREX_RISK.remainderPct,
    breakevenAfterR: DEFAULT_FOREX_RISK.breakevenAfterR,
    trailAtrMult: DEFAULT_FOREX_RISK.trailAtrMult,
    maxSpreadPips: spec.maxSpreadPips,
    maxSlippagePips: DEFAULT_FOREX_RISK.maxSlippagePips,
  };
  const steps = [
    ...opts.signal.pipeline.steps,
    step('USER_CLICKS', true, `${opts.signal.side} clicked`),
    step('RECHECK', true, 'Live conditions passed'),
    step('EXECUTE', true, `Paper fill ${opts.fill} · ${opts.lots} lots`),
    step('PROTECT', true, `SL ${protect.sl} · TP1 ${protect.tp1} · TP2 ${protect.tp2}`),
  ];
  return {
    id: `fxp_${now.getTime()}_${opts.signal.symbol}`,
    signalId: opts.signal.id,
    symbol: opts.signal.symbol,
    side: opts.signal.side,
    mode: opts.mode,
    openedAt: now.toISOString(),
    entry: roundPrice(spec, opts.fill),
    lotsOriginal: opts.lots,
    lotsOpen: opts.lots,
    sl: protect.sl,
    tp1: protect.tp1,
    tp2: protect.tp2,
    tp1Filled: false,
    tp2Filled: false,
    breakevenOn: false,
    trailingOn: false,
    realizedUsd: 0,
    unrealizedUsd: 0,
    maePips: 0,
    mfePips: 0,
    protect,
    events: [`Opened ${opts.signal.side} ${opts.lots} @ ${opts.fill}`],
    pipeline: { stage: 'PROTECT', steps },
  };
}

export type ManageResult = {
  position: FxPosition;
  closed: boolean;
  exitReason?: string;
  exitPrice?: number;
};

export function managePosition(position: FxPosition, market: PairMarket, now = new Date()): ManageResult {
  if (position.lotsOpen <= 0) return { position, closed: true, exitReason: 'already-closed' };
  const spec = market.spec;
  const quote = market.quote;
  const mark = position.side === 'BUY' ? quote.bid : quote.ask;
  const dir = position.side === 'BUY' ? 1 : -1;
  const pips = ((mark - position.entry) * dir) / spec.pipSize;
  position.mfePips = Math.max(position.mfePips, pips);
  position.maePips = Math.min(position.maePips, pips);
  position.unrealizedUsd = pnlUsd({
    spec,
    side: position.side,
    entry: position.entry,
    exit: mark,
    lots: position.lotsOpen,
  });
  position.pipeline.stage = 'MONITOR';

  const stopHit = position.side === 'BUY' ? mark <= position.sl : mark >= position.sl;
  if (stopHit) {
    return closeLots(position, mark, position.lotsOpen, pips < 0 ? 'STOP_LOSS' : 'TRAIL_OR_BE', now);
  }

  const stopPips = Math.max(pipsBetween(spec, position.entry, position.protect.sl), 0.1);
  const rNow = pips / stopPips;

  if (!position.tp1Filled && ((position.side === 'BUY' && mark >= position.tp1) || (position.side === 'SELL' && mark <= position.tp1))) {
    const closeQty = roundLots(position.lotsOriginal * (position.protect.tp1ClosePct / 100));
    const after = closeLots(position, mark, Math.min(closeQty, position.lotsOpen), 'TP1', now);
    after.position.tp1Filled = true;
    after.position.breakevenOn = true;
    after.position.sl = roundPrice(spec, position.entry + dir * spec.pipSize);
    after.position.events.push('Breakeven on — SL moved to entry + 1 pip');
    after.position.pipeline.stage = 'MANAGE';
    after.position.pipeline.steps.push(step('MANAGE', true, 'TP1 filled · breakeven armed'));
    if (after.closed) return after;
    position = after.position;
  }

  if (!position.tp2Filled && ((position.side === 'BUY' && mark >= position.tp2) || (position.side === 'SELL' && mark <= position.tp2))) {
    const closeQty = roundLots(position.lotsOriginal * (position.protect.tp2ClosePct / 100));
    const after = closeLots(position, mark, Math.min(closeQty, position.lotsOpen), 'TP2', now);
    after.position.tp2Filled = true;
    after.position.trailingOn = true;
    after.position.events.push('Trailing stop armed on remainder');
    after.position.pipeline.stage = 'MANAGE';
    after.position.pipeline.steps.push(step('MANAGE', true, 'TP2 filled · trailing remainder'));
    if (after.closed) return after;
    position = after.position;
  }

  if (position.trailingOn && market.atr) {
    const trail = market.atr * position.protect.trailAtrMult;
    const candidate = roundPrice(spec, mark - dir * trail);
    const improves =
      position.side === 'BUY' ? candidate > position.sl : candidate < position.sl;
    if (improves) {
      position.sl = candidate;
      position.events.push(`Trail SL -> ${candidate}`);
      position.pipeline.stage = 'MANAGE';
    }
  } else if (position.breakevenOn && rNow >= position.protect.breakevenAfterR && !position.trailingOn) {
    const be = roundPrice(spec, position.entry + dir * spec.pipSize);
    const improves = position.side === 'BUY' ? be > position.sl : be < position.sl;
    if (improves) position.sl = be;
  }

  return { position, closed: position.lotsOpen <= 0 };
}

function closeLots(
  position: FxPosition,
  price: number,
  lots: number,
  reason: string,
  now: Date,
): ManageResult {
  const spec = getPair(position.symbol);
  const qty = Math.min(lots, position.lotsOpen);
  const pnl = pnlUsd({ spec, side: position.side, entry: position.entry, exit: price, lots: qty });
  position.realizedUsd += pnl;
  position.lotsOpen = roundLots(position.lotsOpen - qty);
  position.events.push(`${reason}: closed ${qty} @ ${price} · ${pnl.toFixed(2)} USD`);
  const closed = position.lotsOpen <= 0;
  if (closed) {
    position.unrealizedUsd = 0;
    position.pipeline.stage = 'EXIT';
    position.pipeline.steps.push(step('EXIT', true, reason, now));
  }
  return { position, closed, exitReason: reason, exitPrice: price };
}

function roundLots(n: number): number {
  return Math.max(0, Math.round(n * 100) / 100);
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
