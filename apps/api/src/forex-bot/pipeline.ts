import {
  DEFAULT_FOREX_RISK,
  FOREX_DISCLAIMER,
  type FxBoardRow,
  type FxPosition,
  type FxSignal,
  type PipelineStep,
} from './types';
import { analyzePair, dedupeKey } from './analysis';
import { lotsForRisk, pipValueUsd } from './pairs';
import { filterReasonsForTime, sessionSnapshot } from './calendar';
import type { PairMarket } from './market';
import { isQuoteStale } from './market';
import { step } from './execution';
import { correlationBlock, wouldBreachUsdCap } from './risk';

export type ScanRejected = {
  symbol: string;
  stage: 'SCAN' | 'FILTER' | 'ANALYZE' | 'SCORE' | 'VALIDATE';
  reasons: string[];
};

export type ScanResult = {
  pipeline: PipelineStep[];
  board: FxBoardRow[];
  signals: FxSignal[];
  rejected: ScanRejected[];
  duplicateSuppressed: number;
  disclaimer: string;
};

export function runScan(opts: {
  markets: PairMarket[];
  now: Date;
  balance: number;
  open: FxPosition[];
  existing: FxSignal[];
}): ScanResult {
  const now = opts.now;
  const steps: PipelineStep[] = [step('SCAN', true, `Scanned ${opts.markets.length} pairs`, now)];
  const session = sessionSnapshot(now);
  const rejected: ScanRejected[] = [];
  const signals: FxSignal[] = [];
  const board: FxBoardRow[] = [];
  let duplicateSuppressed = 0;
  const dayKey = now.toISOString().slice(0, 10);

  for (const market of opts.markets) {
    const timeFilters = filterReasonsForTime(now, market.spec);
    const stale = isQuoteStale(market.quote, now.getTime());
    const extra = stale ? [`Stale quote ${Math.round(market.quote.ageMs / 1000)}s`] : [];
    const analysis = analyzePair(market, session, [...timeFilters, ...extra]);

    let signal: FxSignal | null = null;
    if (analysis.side && analysis.zone && analysis.stopLoss != null && analysis.takeProfit1 != null) {
      const key = dedupeKey(market.spec.symbol, analysis.side, analysis.zone, dayKey);
      const dup =
        opts.existing.find((s) => s.dedupeKey === key && s.expiresAt > now.toISOString()) ||
        signals.find((s) => s.dedupeKey === key);
      const corr = correlationBlock(market.spec.symbol, analysis.side, opts.open);
      const lots = lotsForRisk({
        spec: market.spec,
        price: market.quote.mid,
        stopPips: Math.max(analysis.stopPips, 1),
        balance: opts.balance,
      });
      const exposure = wouldBreachUsdCap(market.spec.symbol, analysis.side, lots, opts.open);
      const blockers = [...analysis.filtersFailed];
      if (dup) {
        duplicateSuppressed += 1;
        blockers.push('Duplicate setup suppressed');
        signal = dup;
      } else {
        if (corr) blockers.push(corr);
        if (exposure) blockers.push('USD correlation/exposure cap');
        if (opts.open.length >= DEFAULT_FOREX_RISK.maxOpenPositions) blockers.push('Max open positions reached');
        const tradeable = analysis.tradeable && !corr && !exposure;
        signal = {
          id: `fxs_${market.spec.symbol}_${now.getTime()}`,
          dedupeKey: key,
          symbol: market.spec.symbol,
          side: analysis.side,
          quote: market.quote,
          zone: analysis.zone,
          stopLoss: analysis.stopLoss,
          takeProfit1: analysis.takeProfit1,
          takeProfit2: analysis.takeProfit2!,
          stopPips: analysis.stopPips,
          tp1Pips: analysis.tp1Pips,
          tp2Pips: analysis.tp2Pips,
          riskReward1: analysis.riskReward1,
          suggestedLots: lots,
          riskUsd: Number((opts.balance * (DEFAULT_FOREX_RISK.riskPerTradePct / 100)).toFixed(2)),
          pipValueUsd: Number(pipValueUsd(market.spec, market.quote.mid, lots).toFixed(2)),
          setupQuality: analysis.setupQuality,
          breakdown: analysis.breakdown,
          confidence: analysis.confidence,
          reasons: analysis.reasons,
          filtersFailed: blockers,
          expiresAt: new Date(now.getTime() + DEFAULT_FOREX_RISK.signalTtlMs).toISOString(),
          createdAt: now.toISOString(),
          pipeline: {
            stage: tradeable ? 'NOTIFY' : 'VALIDATE',
            steps: [
              step('SCAN', true, `${market.spec.symbol} ${market.quote.mid}`, now),
              step('FILTER', timeFilters.length === 0, timeFilters[0] ?? 'Session/news ok', now),
              step('ANALYZE', true, analysis.reasons[0] ?? `${analysis.bias}`, now),
              step(
                'SCORE',
                true,
                `BUY ${analysis.buyPct}% · SELL ${analysis.sellPct}% · quality ${analysis.setupQuality}`,
                now,
              ),
              step('VALIDATE', tradeable, tradeable ? 'Ready for click' : blockers[0] ?? 'Not tradeable', now),
              step('NOTIFY', true, `${analysis.bias} ${analysis.buyPct}/${analysis.sellPct}`, now),
            ],
          },
          notified: true,
        };
        signals.push(signal);
        if (!tradeable) {
          rejected.push({
            symbol: market.spec.symbol,
            stage: 'VALIDATE',
            reasons: blockers.length ? blockers : ['Watch only'],
          });
        }
      }
    } else {
      rejected.push({
        symbol: market.spec.symbol,
        stage: analysis.setupQuality > 0 ? 'SCORE' : 'ANALYZE',
        reasons: analysis.filtersFailed.length ? analysis.filtersFailed : ['WAIT'],
      });
    }

    board.push({
      symbol: market.spec.symbol,
      bid: market.quote.bid,
      ask: market.quote.ask,
      mid: market.quote.mid,
      spreadPips: market.quote.spreadPips,
      changePct: analysis.changePct,
      changePips: analysis.changePips,
      bias: analysis.bias,
      setupQuality: analysis.setupQuality,
      buyPct: analysis.buyPct,
      sellPct: analysis.sellPct,
      rsi: analysis.rsi,
      atrPips: market.atr ? Number((market.atr / market.spec.pipSize).toFixed(1)) : null,
      tradeable: !!signal && signal.filtersFailed.length === 0 && analysis.tradeable,
      signalId: signal?.id ?? null,
      reasons: analysis.reasons,
      blockers: analysis.filtersFailed,
      stopLoss: analysis.stopLoss,
      takeProfit1: analysis.takeProfit1,
      takeProfit2: analysis.takeProfit2,
      zone: analysis.zone,
      stale: market.quote.stale,
      dataQuality: market.quote.dataQuality,
    });
  }

  board.sort((a, b) => {
    const rank = (r: FxBoardRow) => (r.bias === 'WAIT' ? 0 : r.tradeable ? 2 : 1) * 100 + Math.abs(r.buyPct - 50);
    return rank(b) - rank(a);
  });

  steps.push(step('FILTER', true, `${board.length} pairs on the board`, now));
  steps.push(step('ANALYZE', true, `${board.filter((b) => b.bias !== 'WAIT').length} BUY/SELL leans`, now));
  steps.push(step('SCORE', true, 'BUY% / SELL% is lean strength, not win probability', now));
  steps.push(step('VALIDATE', true, `Duplicates suppressed: ${duplicateSuppressed}`, now));
  steps.push(step('NOTIFY', true, `${board.length} pairs ready to view`, now));

  return { pipeline: steps, board, signals, rejected, duplicateSuppressed, disclaimer: FOREX_DISCLAIMER };
}
