import type { JournalEntry, FxPosition } from './types';
import { getPair, pipsBetween } from './pairs';
import { step } from './execution';

export function toJournal(position: FxPosition, exitPrice: number, reason: string, now = new Date()): JournalEntry {
  const spec = getPair(position.symbol);
  const stopPips = Math.max(pipsBetween(spec, position.entry, position.protect.sl), 0.1);
  const rMultiple = position.realizedUsd === 0 ? 0 : (pipsBetween(spec, position.entry, exitPrice) / stopPips) * (position.side === 'BUY' ? (exitPrice >= position.entry ? 1 : -1) : (exitPrice <= position.entry ? 1 : -1));
  position.pipeline.stage = 'JOURNAL';
  position.pipeline.steps.push(step('JOURNAL', true, `Recorded ${reason}`, now));
  return {
    id: `fxj_${position.id}`,
    positionId: position.id,
    signalId: position.signalId,
    symbol: position.symbol,
    side: position.side,
    openedAt: position.openedAt,
    closedAt: now.toISOString(),
    entry: position.entry,
    exit: exitPrice,
    lots: position.lotsOriginal,
    pnlUsd: Number(position.realizedUsd.toFixed(2)),
    rMultiple: Number(rMultiple.toFixed(2)),
    maePips: Number(position.maePips.toFixed(1)),
    mfePips: Number(position.mfePips.toFixed(1)),
    setupQuality: 0,
    exitReason: reason,
    notes: position.events.slice(),
  };
}

export type Analytics = {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  expectancyUsd: number | null;
  profitFactor: number | null;
  avgR: number | null;
  maxWinUsd: number;
  maxLossUsd: number;
  note: string;
};

export function analytics(entries: JournalEntry[]): Analytics {
  const trades = entries.length;
  const wins = entries.filter((e) => e.pnlUsd > 0).length;
  const losses = entries.filter((e) => e.pnlUsd < 0).length;
  const grossWin = entries.filter((e) => e.pnlUsd > 0).reduce((s, e) => s + e.pnlUsd, 0);
  const grossLoss = Math.abs(entries.filter((e) => e.pnlUsd < 0).reduce((s, e) => s + e.pnlUsd, 0));
  const pnl = entries.reduce((s, e) => s + e.pnlUsd, 0);
  return {
    trades,
    wins,
    losses,
    winRatePct: trades ? Number(((wins / trades) * 100).toFixed(1)) : null,
    expectancyUsd: trades ? Number((pnl / trades).toFixed(2)) : null,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : null,
    avgR: trades ? Number((entries.reduce((s, e) => s + e.rMultiple, 0) / trades).toFixed(2)) : null,
    maxWinUsd: trades ? Math.max(...entries.map((e) => e.pnlUsd)) : 0,
    maxLossUsd: trades ? Math.min(...entries.map((e) => e.pnlUsd)) : 0,
    note: 'Journal stats describe past paper fills only. They are not a forecast.',
  };
}
