import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_FOREX_RISK,
  FOREX_DISCLAIMER,
  PIPELINE_STAGES,
  type FxMode,
  type FxPosition,
  type FxSignal,
  type JournalEntry,
} from './types';
import { PAIRS } from './pairs';
import { activeBlackouts, highImpactEvents, sessionSnapshot } from './calendar';
import { loadMarkets, refreshQuote, type PairMarket } from './market';
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

  constructor(
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
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
        'Telegram/email when a pair leans BUY or SELL at 60%+ (every 3 minutes, same setup at most once per 45 minutes). Open FX BOT and tap to recheck before any fill.',
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

  async recheck(id: string, side: 'BUY' | 'SELL') {
    const signal = this.requireSignal(id);
    const now = new Date();
    const loaded = await loadMarkets(now, true);
    const market = loaded.markets.find((m) => m.spec.symbol === signal.symbol);
    if (!market) throw new BadRequestException('No live market for this pair');
    signal.quote = refreshQuote(market, now);
    const check = recheckLive({ signal, market, now, requestedSide: side });
    return {
      signal,
      ...check,
      pipelineStage: 'RECHECK',
      disclaimer: FOREX_DISCLAIMER,
    };
  }

  async execute(id: string, side: 'BUY' | 'SELL') {
    const signal = this.requireSignal(id);
    const now = new Date();
    if (this.killSwitch) throw new BadRequestException('Kill switch is ON — execution blocked');
    const dd = this.drawdown();
    if (dd.dailyHalt || dd.weeklyHalt) {
      throw new BadRequestException('Drawdown halt — no new trades');
    }
    const loaded = await loadMarkets(now, true);
    const market = loaded.markets.find((m) => m.spec.symbol === signal.symbol);
    if (!market) throw new BadRequestException('No live market for this pair');
    const live = recheckLive({ signal, market, now, requestedSide: side });
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
    return { position, fill, disclaimer: FOREX_DISCLAIMER };
  }

  positionsList() {
    return { items: this.openPositions(), count: this.openPositions().length };
  }

  async tick() {
    const now = new Date();
    const loaded = await loadMarkets(now);
    const events = await this.tickPositions(loaded.markets, now);
    return { events, positions: this.openPositions(), journal: this.journal.slice(-20) };
  }

  async close(id: string) {
    const pos = this.positions.find((p) => p.id === id && p.lotsOpen > 0);
    if (!pos) throw new NotFoundException('Position not found');
    const now = new Date();
    const loaded = await loadMarkets(now, true);
    const market = loaded.markets.find((m) => m.spec.symbol === pos.symbol);
    if (!market) throw new BadRequestException('No live market');
    const mark = pos.side === 'BUY' ? market.quote.bid : market.quote.ask;
    pos.lotsOpen = 0;
    const entry = toJournal(pos, mark, 'MANUAL_CLOSE', now);
    this.applyClose(pos, entry);
    return { position: pos, journal: entry };
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

  private async tickPositions(markets: PairMarket[], now: Date) {
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
      }
    }
    return events;
  }

  private applyClose(pos: FxPosition, entry: JournalEntry) {
    this.balance = Number((this.balance + pos.realizedUsd).toFixed(2));
    this.journal.push(entry);
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

  private async alertBoard(board: Array<{
    symbol: string;
    bias: string;
    buyPct: number;
    sellPct: number;
    setupQuality: number;
    mid: number;
    rsi: number | null;
    zone: { low: number; high: number } | null;
    stopLoss: number | null;
    takeProfit1: number | null;
    takeProfit2: number | null;
    reasons: string[];
  }>) {
    for (const row of board) {
      if (row.bias !== 'BUY' && row.bias !== 'SELL') continue;
      const lean = row.bias === 'BUY' ? row.buyPct : row.sellPct;
      if (lean < 60) continue;
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
          reason: row.reasons[0] ?? `${row.bias} lean ${lean}%`,
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
