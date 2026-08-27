import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { fetchTokenOhlcv } from '@memecoinbot/data-providers';
import {
  runBacktest,
  trackSignalOutcome,
  type BacktestResult,
  type SignalOutcome,
} from '@memecoinbot/backtest';
import type { Timeframe } from '@memecoinbot/indicators';
import { StrategyId } from '@memecoinbot/shared';
import { SignalsService } from '../signals/signals.service';

@Injectable()
export class BacktestsService {
  private readonly logger = new Logger(BacktestsService.name);
  private readonly history: Array<BacktestResult & { id: string; address: string }> = [];
  private readonly outcomes: Array<{
    id: string;
    address: string;
    signalType: string;
    outcome: SignalOutcome;
    trackedAt: string;
  }> = [];

  constructor(private readonly signalsService: SignalsService) {}

  list() {
    return { items: this.history, count: this.history.length };
  }

  getOne(id: string) {
    const item = this.history.find((h) => h.id === id);
    if (!item) throw new BadRequestException('Backtest not found');
    return item;
  }

  listOutcomes() {
    return { items: this.outcomes, count: this.outcomes.length };
  }

  async run(body: {
    address: string;
    timeframe?: Timeframe;
    startingBalance?: number;
    strategyId?: StrategyId | 'ALL';
    outOfSamplePct?: number;
    symbol?: string;
  }) {
    const timeframe = body.timeframe ?? '5m';
    const ohlcv = await fetchTokenOhlcv(body.address, timeframe, null);
    if (!ohlcv.ok || !ohlcv.data) {
      throw new ServiceUnavailableException(
        ohlcv.error ?? 'OHLCV unavailable for backtest',
      );
    }

    // Fetch a longer window when possible
    const candles = ohlcv.data.candles;
    if (candles.length < 80) {
      throw new BadRequestException(
        `Insufficient history (${candles.length} bars). Need at least 80.`,
      );
    }

    try {
      const result = runBacktest(candles, {
        startingBalance: body.startingBalance ?? 1000,
        timeframe,
        strategyId: body.strategyId ?? 'ALL',
        tokenAddress: body.address,
        symbol: body.symbol ?? 'TOKEN',
        outOfSamplePct: body.outOfSamplePct ?? 0.3,
        warmupBars: 60,
        minBarsBetweenEntries: 5,
      });

      const saved = {
        ...result,
        id: `bt_${Date.now()}`,
        address: body.address,
      };
      this.history.unshift(saved);
      if (this.history.length > 50) this.history.length = 50;

      this.logger.log(
        `Backtest ${body.address} full trades=${result.full.entriesTaken} oos trades=${result.outOfSample.entriesTaken}`,
      );
      return saved;
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Backtest failed',
      );
    }
  }

  async trackAddress(address: string) {
    const signal = await this.signalsService.generateForAddress(address);
    const ohlcv = await fetchTokenOhlcv(address, '5m', null);
    if (!ohlcv.ok || !ohlcv.data) {
      throw new ServiceUnavailableException('OHLCV unavailable for outcome tracking');
    }

    const signalTime = Math.floor(Date.now() / 1000) - 3600; // approximate: evaluate last hour path
    const outcome = trackSignalOutcome({
      entryPrice: signal.levels.idealEntry,
      stopLoss: signal.levels.stopLoss,
      tp1Price: signal.levels.tp1Price,
      tp2Price: signal.levels.tp2Price,
      signalTime,
      candles: ohlcv.data.candles,
    });

    const saved = {
      id: `out_${Date.now()}`,
      address,
      signalType: signal.signalType,
      safetyScore: signal.safetyScore,
      signalScore: signal.signalScore,
      levels: signal.levels,
      outcome,
      trackedAt: new Date().toISOString(),
      note: 'Outcome uses recent candles after an approximate signal time. For archived signals, pass explicit timestamps in a later iteration.',
    };
    this.outcomes.unshift(saved);
    if (this.outcomes.length > 100) this.outcomes.length = 100;
    return saved;
  }
}
