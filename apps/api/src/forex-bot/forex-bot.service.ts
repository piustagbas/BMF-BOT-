import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import {
  DEFAULT_FOREX_RISK,
  FOREX_DISCLAIMER,
  PIPELINE_STAGES,
  type FxMode,
  type FxPosition,
  type FxSignal,
  type JournalEntry,
} from './types';
import { PAIRS, getPair, pnlUsd } from './pairs';
import { activeBlackouts, filterReasonsForTime, highImpactEvents, sessionSnapshot } from './calendar';
import { fetchYahooOhlcv, loadMarkets, normalizeFxInterval, refreshQuote, toChartCandles, type PairMarket } from './market';
import { analyzePair, buildFxWhyNotBuy, shouldAlertFx } from './analysis';
import { analyzeCandlestickStructure } from '@memecoinbot/indicators';
import { runScan } from './pipeline';
import { buildRiskSnapshot, drawdownState } from './risk';
import {
  brokerExecutionChecks,
  managePosition,
  openProtectedPosition,
  recheckLive,
} from './execution';
import { analytics, toJournal } from './journal';
import { demoWalkForward } from './backtest';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { TradeNotificationsService } from '../notifications/trade-notifications.service';
import { completionKindForPnl } from '../notifications/trade-events';

@Injectable()
export class ForexBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ForexBotService.name);
  private killSwitch = true;
  private mode: FxMode = 'PAPER';
  private balance: number = DEFAULT_FOREX_RISK.startingBalance;
  private startingBalance: number = DEFAULT_FOREX_RISK.startingBalance;
  private signals: FxSignal[] = [];
  private positions: FxPosition[] = [];
  private journal: JournalEntry[] = [];
  private weekStart = isoWeekStart(new Date());
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private firstScanTimer: ReturnType<typeof setTimeout> | null = null;
  private scanning = false;
  private readonly autoFilled = new Set<string>();

  constructor(
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly tradeNotifications: TradeNotificationsService,
  ) {}

  onModuleInit() {
    this.firstScanTimer = setTimeout(() => void this.scanAndAlert(), 35_000);
    this.scanTimer = setInterval(() => void this.scanAndAlert(), 3 * 60 * 1000);
    this.logger.log('FX BUY/SELL alert scanner armed (first run in 35s, then every 3m)');
  }

  onModuleDestroy() {
    if (this.firstScanTimer) clearTimeout(this.firstScanTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
  }

  status() {
    const now = new Date();
    const session = sessionSnapshot(now);
    return {
      pipeline: PIPELINE_STAGES,
      mode: this.mode,
      killSwitch: this.killSwitch,
      autoTradeForex: this.settings.getSettings().autoTradeForex,
      paperDefault: true,
      liveBroker: null,
      liveBlockedReason: 'No live FX broker adapter is connected. Paper/demo only.',
      session,
      news: activeBlackouts(now).slice(0, 8),
      pairs: PAIRS.map((p) => p.symbol),
      staleQuoteMs: DEFAULT_FOREX_RISK.staleQuoteMs,
      disclaimer: FOREX_DISCLAIMER,
      scoringNote:
        'Setup quality is 0–100 for the quality of the setup. It is not the probability of a winning trade.',
      alerts:
        'Telegram/email only when a pair is tradeable (same bar as the in-app BUY/SELL button). Lean without passing tests does not alert.',
      notifyFxSetups: this.settings.getSettings().notifyFxSetups !== false,
    };
  }

  async scan() {
    const now = new Date();
    this.maybeRollWeek(now);
    const dd = this.drawdown();
    if (dd.dailyHalt || dd.weeklyHalt) {
      return {
        ...emptyScan(now),
        halt: dd.dailyHalt ? 'Daily drawdown halt' : 'Weekly drawdown halt',
        risk: this.risk(),
        quotes: [],
        board: [],
        source: '',
        fetchedAt: now.toISOString(),
        session: sessionSnapshot(now),
      };
    }
    try {
      const loaded = await loadMarkets(now);
      await this.tickPositions(loaded.markets, now);
      const result = runScan({
        markets: loaded.markets,
        now,
        balance: this.balance,
        open: this.openPositions(),
        existing: this.liveSignals(now),
      });
      this.mergeSignals(result.signals, now);
      await this.alertBoard(result.board);
      await this.autoFillPassedSetups(result.board);
      return {
        ...result,
        source: loaded.source,
        fetchedAt: loaded.fetchedAt,
        session: sessionSnapshot(now),
        quotes: loaded.markets.map((m) => m.quote),
        board: result.board,
        risk: this.risk(),
        halt: null as string | null,
      };
    } catch (err) {
      this.logger.warn(`FX scan failed: ${err instanceof Error ? err.message : err}`);
      return {
        ...emptyScan(now),
        source: '',
        fetchedAt: now.toISOString(),
        session: sessionSnapshot(now),
        quotes: [],
        board: [],
        risk: this.risk(),
        halt: err instanceof Error ? err.message : 'FX scan failed',
      };
    }
  }

  signalsList() {
    return {
      items: this.liveSignals(new Date()),
      count: this.liveSignals(new Date()).length,
      disclaimer: FOREX_DISCLAIMER,
    };
  }

  getSignal(id: string) {
    const signal = this.signals.find((s) => s.id === id);
    if (!signal) throw new NotFoundException('Signal not found');
    return { signal, disclaimer: FOREX_DISCLAIMER };
  }

  async pairDetail(symbol: string, timeframe?: string) {
    const spec = (() => {
      try {
        return getPair(symbol);
      } catch {
        throw new NotFoundException('Unknown pair');
      }
    })();
    const now = new Date();
    const interval = normalizeFxInterval(timeframe);
    const loaded = await loadMarkets(now);
    const market = loaded.markets.find((m) => m.spec.symbol === spec.symbol);
    if (!market) throw new NotFoundException('No live market for this pair');
    let chartCandles = market.candles;
    if (interval !== '15m') {
      try {
        const fetched = await fetchYahooOhlcv(spec, interval, now);
        if (fetched.length >= 8) chartCandles = fetched;
      } catch {
        chartCandles = market.candles;
      }
    }
    const session = sessionSnapshot(now);
    const timeFilters = filterReasonsForTime(now, spec);
    const analysis = analyzePair(market, session, timeFilters);
    const candlestick = analyzeCandlestickStructure(chartCandles.length ? chartCandles : market.candles);
    const signal =
      this.liveSignals(now).find((s) => s.symbol === spec.symbol) ??
      this.signals.find((s) => s.symbol === spec.symbol) ??
      null;
    const whyNotBuy = buildFxWhyNotBuy({
      analysis,
      market,
      candles: candlestick,
      session,
      requestedSide: analysis.side,
    });
    return {
      symbol: spec.symbol,
      interval,
      source: loaded.source,
      quote: refreshQuote(market, now),
      analysis: {
        bias: analysis.bias,
        side: analysis.side,
        buyPct: analysis.buyPct,
        sellPct: analysis.sellPct,
        setupQuality: analysis.setupQuality,
        rsi: analysis.rsi,
        changePct: analysis.changePct,
        changePips: analysis.changePips,
        zone: analysis.zone,
        stopLoss: analysis.stopLoss,
        takeProfit1: analysis.takeProfit1,
        takeProfit2: analysis.takeProfit2,
        riskReward1: analysis.riskReward1,
        tradeable: analysis.tradeable,
        reasons: analysis.reasons,
        filtersFailed: analysis.filtersFailed,
        breakdown: analysis.breakdown,
        confidence: analysis.confidence,
      },
      candlestick,
      candles: toChartCandles(chartCandles),
      whyNotBuy,
      signal,
      session,
      disclaimer: FOREX_DISCLAIMER,
    };
  }

  async recheck(id: string, side: 'BUY' | 'SELL') {
    const signal = this.requireSignal(id);
    const now = new Date();
    const loaded = await loadMarkets(now, true);
    const market = loaded.markets.find((m) => m.spec.symbol === signal.symbol);
    if (!market) throw new BadRequestException('No live market for this pair');
    signal.quote = refreshQuote(market, now);
    const check = recheckLive({ signal, market, now, requestedSide: side, mode: this.mode });
    return {
      signal,
      ...check,
      pipelineStage: 'RECHECK',
      disclaimer: FOREX_DISCLAIMER,
    };
  }

  async execute(id: string, side: 'BUY' | 'SELL', user?: IUser) {
    const attemptId = `forex:${id}:${side}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    let symbol = 'FOREX';
    try {
      const signal = this.requireSignal(id);
      symbol = signal.symbol;
      const now = new Date();
      if (this.mode === 'LIVE' && this.killSwitch) {
        throw new BadRequestException('Kill switch is ON — live execution blocked');
      }
      const dd = this.drawdown();
      if (dd.dailyHalt || dd.weeklyHalt) {
        throw new BadRequestException('Drawdown halt — no new trades');
      }
      const loaded = await loadMarkets(now, true);
      const market = loaded.markets.find((m) => m.spec.symbol === signal.symbol);
      if (!market) throw new BadRequestException('No live market for this pair');
      const live = recheckLive({ signal, market, now, requestedSide: side, mode: this.mode });
      if (!live.ok || !live.quote) {
        throw new BadRequestException(live.blockers.join('; ') || 'Live recheck failed');
      }
      const broker = brokerExecutionChecks({
        mode: this.mode,
        killSwitch: this.killSwitch,
        liveBlockedReason: 'No live FX broker adapter is connected. Paper/demo only.',
        quote: live.quote,
      });
      if (broker.length) throw new BadRequestException(broker.join('; '));
      const fill = side === 'BUY' ? live.quote.ask : live.quote.bid;
      const position = openProtectedPosition({
        signal,
        fill,
        lots: signal.suggestedLots,
        mode: this.mode,
        atr: market.atr ?? 0,
        now,
      });
      this.positions.push(position);
      signal.pipeline.stage = 'EXECUTE';
      signal.expiresAt = now.toISOString();
      await this.notifyTradeResult(user ?? null, {
        kind: 'TRADE_SUCCEEDED',
        eventId: `${attemptId}:success`,
        symbol,
        side,
        assetClass: 'FOREX',
        executionMode: this.mode === 'LIVE' ? 'LIVE' : 'PAPER',
        tokenQuantity: position.lotsOriginal,
        entryPrice: fill,
      });
      return { position, fill, disclaimer: FOREX_DISCLAIMER };
    } catch (err) {
      await this.notifyTradeResult(user ?? null, {
        kind: 'TRADE_FAILED',
        eventId: `${attemptId}:failed`,
        symbol,
        side,
        assetClass: 'FOREX',
        executionMode: this.mode === 'LIVE' ? 'LIVE' : 'PAPER',
        reason: err instanceof Error ? err.message : 'Forex trade failed',
      });
      throw err;
    }
  }

  positionsList() {
    return { items: this.openPositions(), count: this.openPositions().length };
  }

  async tick(user?: IUser) {
    const now = new Date();
    const loaded = await loadMarkets(now);
    const events = await this.tickPositions(loaded.markets, now, user);
    return { events, positions: this.openPositions(), journal: this.journal.slice(-20) };
  }

  async close(id: string, user?: IUser) {
    const attemptId = `forex:close:${id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    let symbol = 'FOREX';
    try {
      const pos = this.positions.find((p) => p.id === id && p.lotsOpen > 0);
      if (!pos) throw new NotFoundException('Position not found');
      symbol = pos.symbol;
      const now = new Date();
      const loaded = await loadMarkets(now, true);
      const market = loaded.markets.find((m) => m.spec.symbol === pos.symbol);
      if (!market) throw new BadRequestException('No live market');
      const mark = pos.side === 'BUY' ? market.quote.bid : market.quote.ask;
      const lotsToClose = pos.lotsOpen;
      pos.realizedUsd += pnlUsd({
        spec: getPair(pos.symbol),
        side: pos.side,
        entry: pos.entry,
        exit: mark,
        lots: lotsToClose,
      });
      pos.lotsOpen = 0;
      const entry = toJournal(pos, mark, 'MANUAL_CLOSE', now);
      this.applyClose(pos, entry);
      await this.notifyTradeResult(user ?? null, {
        kind: completionKindForPnl(entry.pnlUsd) ?? 'TRADE_LOSS',
        eventId: `${attemptId}:result`,
        symbol,
        side: entry.side,
        assetClass: 'FOREX',
        executionMode: this.mode === 'LIVE' ? 'LIVE' : 'PAPER',
        tokenQuantity: entry.lots,
        entryPrice: entry.entry,
        exitPrice: entry.exit,
        pnlUsd: entry.pnlUsd,
        roiPct: entry.entry > 0
          ? ((entry.exit - entry.entry) / entry.entry) * (entry.side === 'BUY' ? 100 : -100)
          : undefined,
        reason: entry.exitReason,
        tradeId: entry.positionId,
      });
      return { position: pos, journal: entry };
    } catch (err) {
      await this.notifyTradeResult(user ?? null, {
        kind: 'TRADE_FAILED',
        eventId: `${attemptId}:failed`,
        symbol,
        side: 'SELL',
        assetClass: 'FOREX',
        executionMode: this.mode === 'LIVE' ? 'LIVE' : 'PAPER',
        reason: err instanceof Error ? err.message : 'Forex close failed',
      });
      throw err;
    }
  }

  journalList() {
    return { items: this.journal, analytics: analytics(this.journal), disclaimer: FOREX_DISCLAIMER };
  }

  risk() {
    const open = this.openPositions();
    const equity =
      this.balance + open.reduce((s, p) => s + p.unrealizedUsd + p.realizedUsd, 0);
    return buildRiskSnapshot({
      balance: this.balance,
      equity,
      startingBalance: this.startingBalance,
      dailyPnlUsd: this.dailyPnl(),
      weeklyPnlUsd: this.weeklyPnl(),
      open,
      killSwitch: this.killSwitch,
      mode: this.mode,
      liveBlockedReason: 'No live FX broker adapter is connected. Paper/demo only.',
    });
  }

  calendar() {
    const now = new Date();
    const to = new Date(now.getTime() + 14 * 86400_000);
    return {
      session: sessionSnapshot(now),
      upcoming: highImpactEvents(now, to).slice(0, 24),
      active: activeBlackouts(now),
    };
  }

  backtest() {
    return demoWalkForward();
  }

  setKillSwitch(on: boolean) {
    this.killSwitch = on;
    return this.status();
  }

  setMode(mode: FxMode) {
    if (mode === 'LIVE') {
      throw new BadRequestException('Live trading is blocked until a broker adapter is connected. Stay on paper/demo.');
    }
    this.mode = mode;
    return this.status();
  }

  emergencyStop() {
    const now = new Date();
    this.killSwitch = true;
    const closed: JournalEntry[] = [];
    for (const pos of this.openPositions()) {
      const mark = pos.entry;
      pos.lotsOpen = 0;
      const entry = toJournal(pos, mark, 'EMERGENCY_STOP', now);
      this.applyClose(pos, entry);
      closed.push(entry);
    }
    this.logger.warn(`Emergency stop closed ${closed.length} positions`);
    return { killSwitch: true, closed, disclaimer: FOREX_DISCLAIMER };
  }

  private requireSignal(id: string): FxSignal {
    const signal = this.signals.find((s) => s.id === id);
    if (!signal) throw new NotFoundException('Signal not found');
    return signal;
  }

  private liveSignals(now: Date) {
    return this.signals.filter((s) => s.expiresAt > now.toISOString());
  }

  private openPositions() {
    return this.positions.filter((p) => p.lotsOpen > 0);
  }

  private mergeSignals(incoming: FxSignal[], now: Date) {
    const liveKeys = new Set(this.liveSignals(now).map((s) => s.dedupeKey));
    for (const s of incoming) {
      if (liveKeys.has(s.dedupeKey)) continue;
      this.signals.push(s);
      liveKeys.add(s.dedupeKey);
    }
    if (this.signals.length > 80) this.signals = this.signals.slice(-80);
  }

  private async tickPositions(markets: PairMarket[], now: Date, user?: IUser) {
    const events: string[] = [];
    const bySym = new Map(markets.map((m) => [m.spec.symbol, m]));
    for (const pos of this.openPositions()) {
      const market = bySym.get(pos.symbol);
      if (!market) continue;
      const result = managePosition(pos, market, now);
      events.push(...result.position.events.slice(-2));
      if (result.closed && result.exitPrice && result.exitReason) {
        const entry = toJournal(result.position, result.exitPrice, result.exitReason, now);
        const sig = this.signals.find((s) => s.id === pos.signalId);
        if (sig) entry.setupQuality = sig.setupQuality;
        this.applyClose(result.position, entry);
        const kind = fxExitKind(result.exitReason);
        if (kind) {
          void this.notifications.notifyFxExit({
            kind,
            symbol: pos.symbol,
            detail: `${pos.side} closed · ${result.exitReason} @ ${result.exitPrice}`,
          });
        }
        await this.notifyTradeResult(user ?? null, {
          kind: completionKindForPnl(entry.pnlUsd) ?? 'TRADE_LOSS',
          eventId: `forex:result:${entry.id}`,
          symbol: entry.symbol,
          side: entry.side,
          assetClass: 'FOREX',
          executionMode: pos.mode === 'LIVE' ? 'LIVE' : 'PAPER',
          tokenQuantity: entry.lots,
          entryPrice: entry.entry,
          exitPrice: entry.exit,
          pnlUsd: entry.pnlUsd,
          roiPct: entry.entry > 0
            ? ((entry.exit - entry.entry) / entry.entry) * (entry.side === 'BUY' ? 100 : -100)
            : undefined,
          reason: entry.exitReason,
          tradeId: entry.positionId,
        });
      }
    }
    return events;
  }

  private applyClose(pos: FxPosition, entry: JournalEntry) {
    this.balance = Number((this.balance + pos.realizedUsd).toFixed(2));
    this.journal.push(entry);
  }

  private async notifyTradeResult(
    user: IUser | null,
    payload: Parameters<TradeNotificationsService['emit']>[1],
  ) {
    try {
      await this.tradeNotifications.emit(user, payload);
    } catch (err) {
      this.logger.warn(
        `Trade result notification failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private dailyPnl() {
    const day = new Date().toISOString().slice(0, 10);
    return this.journal.filter((j) => j.closedAt.slice(0, 10) === day).reduce((s, j) => s + j.pnlUsd, 0);
  }

  private weeklyPnl() {
    return this.journal.filter((j) => j.closedAt >= this.weekStart).reduce((s, j) => s + j.pnlUsd, 0);
  }

  private drawdown() {
    return drawdownState({
      balance: this.balance,
      startingBalance: this.startingBalance,
      dailyPnlUsd: this.dailyPnl(),
      weeklyPnlUsd: this.weeklyPnl(),
    });
  }

  private maybeRollWeek(now: Date) {
    const start = isoWeekStart(now);
    if (start !== this.weekStart) this.weekStart = start;
  }

  private async scanAndAlert() {
    if (this.scanning) return;
    const session = sessionSnapshot(new Date());
    if (!session.forexOpen) {
      this.logger.log('FX alert scan skipped — market closed');
      return;
    }
    this.scanning = true;
    try {
      const result = await this.scan();
      this.logger.log(
        `FX alert scan: ${result.board?.length ?? 0} pairs, ${
          (result.board ?? []).filter((r) => r.bias === 'BUY' || r.bias === 'SELL').length
        } BUY/SELL leans`,
      );
    } catch (err) {
      this.logger.warn(`FX alert scan failed: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      this.scanning = false;
    }
  }

  private async autoFillPassedSetups(
    board: Array<{
      symbol: string;
      bias: string;
      tradeable: boolean;
      signalId: string | null;
    }>,
  ) {
    const s = this.settings.getSettings();
    if (!s.autoTradeForex || s.emergencyStop) return;
    const dd = this.drawdown();
    if (dd.dailyHalt || dd.weeklyHalt) return;

    for (const row of board) {
      if (!row.tradeable || !row.signalId) continue;
      if (row.bias !== 'BUY' && row.bias !== 'SELL') continue;
      if (this.autoFilled.has(row.signalId)) continue;
      if (this.openPositions().some((p) => p.symbol === row.symbol)) continue;
      try {
        const result = await this.execute(row.signalId, row.bias as 'BUY' | 'SELL');
        this.autoFilled.add(row.signalId);
        this.logger.log(`FX demo auto ${row.bias} ${row.symbol} @ ${result.fill}`);
        await this.notifications.notify(
          `FX AUTO ${row.bias} ${row.symbol}`,
          [
            `Demo ${row.bias} filled at ${result.fill} because every hard test passed.`,
            'Auto-trade is paper/demo only. Tests failed = no fill. Not financial advice.',
            FOREX_DISCLAIMER,
          ].join('\n'),
        );
      } catch (err) {
        this.logger.warn(
          `FX demo auto skipped ${row.symbol}: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
    if (this.autoFilled.size > 60) {
      const keep = [...this.autoFilled].slice(-30);
      this.autoFilled.clear();
      for (const id of keep) this.autoFilled.add(id);
    }
  }

  private async alertBoard(board: Array<{
    symbol: string;
    bias: string;
    buyPct: number;
    sellPct: number;
    setupQuality: number;
    mid: number;
    rsi: number | null;
    tradeable: boolean;
    zone: { low: number; high: number } | null;
    stopLoss: number | null;
    takeProfit1: number | null;
    takeProfit2: number | null;
    reasons: string[];
  }>) {
    for (const row of board) {
      if (!shouldAlertFx(row)) continue;
      try {
        await this.notifications.notifyFxSetup({
          symbol: row.symbol,
          side: row.bias as 'BUY' | 'SELL',
          mid: row.mid,
          buyPct: row.buyPct,
          sellPct: row.sellPct,
          setupQuality: row.setupQuality,
          zoneLow: row.zone?.low ?? null,
          zoneHigh: row.zone?.high ?? null,
          stopLoss: row.stopLoss,
          takeProfit1: row.takeProfit1,
          takeProfit2: row.takeProfit2,
          rsi: row.rsi,
          reason: row.reasons[0] ?? `${row.bias} lean ${row.bias === 'BUY' ? row.buyPct : row.sellPct}%`,
        });
      } catch (err) {
        this.logger.warn(
          `FX ${row.bias} ${row.symbol} alert failed: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
  }
}

function isoWeekStart(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString();
}

function emptyScan(now: Date) {
  return runScan({ markets: [], now, balance: 0, open: [], existing: [] });
}

function fxExitKind(
  reason: string,
): 'TP1' | 'TP2' | 'STOP_LOSS' | 'TRAIL_OR_BE' | 'MANUAL_CLOSE' | null {
  if (reason === 'TP1' || reason === 'TP2' || reason === 'STOP_LOSS' || reason === 'TRAIL_OR_BE' || reason === 'MANUAL_CLOSE') {
    return reason;
  }
  return null;
}
