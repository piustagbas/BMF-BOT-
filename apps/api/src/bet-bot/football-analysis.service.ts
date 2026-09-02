import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { loadTeamSnapshot } from './football.provider';
import { BacktestingService, type BacktestReport } from './backtesting.service';
import { ApiFootballProvider } from './api-football.provider';
import { FootballDataOrgProvider } from './football-data-org.provider';
import { FootballStatisticsService } from './football-statistics.service';
import { FixtureMatchingService, type MatchedFixture } from './fixture-matching.service';
import { OpenAiAnalysisService } from './openai-analysis.service';
import { PredictionEngine } from './prediction-engine';
import { FootballPersistenceService } from './football-persistence.service';
import { ProviderConsensusService } from './provider-consensus.service';
import { ProviderHealthService } from './provider-health.service';
import { SportmonksProvider } from './sportmonks.provider';
import { dateRangeForQuery, footballTimezone, validYmd } from './football-data.utils';
import type {
  FootballProviderName,
  MarketPrediction,
  NormalizedAnalysis,
  NormalizedFixture,
  ProviderFetchOptions,
  ProviderFetchResult,
} from './football-data.types';
import { BET_DISCLAIMER } from './types';

export type FootballFixtureQuery = {
  date?: string;
  day?: string;
  league?: string;
  provider?: string;
};

export type PredictionQuery = FootballFixtureQuery & {
  minimumProbability?: number;
  minimumConfidence?: number;
  market?: string;
  risk?: string;
};

@Injectable()
export class FootballAnalysisService {
  private readonly logger = new Logger(FootballAnalysisService.name);
  private readonly groups = new Map<string, { group: MatchedFixture; results: ProviderFetchResult[]; syncedAt: number }>();
  private readonly generated = new Map<string, { generatedAt: string; predictions: MarketPrediction[] }>();
  private readonly providerCache = new Map<string, { results: ProviderFetchResult[]; at: number }>();
  private static readonly PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly matcher: FixtureMatchingService,
    private readonly consensus: ProviderConsensusService,
    private readonly statistics: FootballStatisticsService,
    private readonly engine: PredictionEngine,
    private readonly openAi: OpenAiAnalysisService,
    private readonly health: ProviderHealthService,
    private readonly persistence: FootballPersistenceService,
    private readonly backtesting: BacktestingService,
    private readonly sportmonks: SportmonksProvider,
    private readonly apiFootball: ApiFootballProvider,
    private readonly footballDataOrg: FootballDataOrgProvider,
  ) {}

  private get adapters() {
    return [this.sportmonks, this.apiFootball, this.footballDataOrg];
  }

  async fixtures(query: FootballFixtureQuery = {}) {
    const groups = await this.collect(query);
    const items = groups
      .filter((matched) => this.matchesFilters(matched.fixture, query, matched.providerFixtures))
      .map((matched) => ({
        ...matched.fixture,
        id: matched.internalId,
        providerIds: matched.providerIds,
        providerAgreement: this.consensus.agreement(matched),
        discrepancies: matched.discrepancies,
      }));
    return {
      timezone: footballTimezone(),
      source: this.adapters.filter((adapter) => adapter.configured()).map((adapter) => adapter.name),
      count: items.length,
      items,
      providers: this.health.all(),
      disclaimer: BET_DISCLAIMER,
    };
  }

  async fixtureData(id: string) {
    const matched = await this.find(id);
    return {
      internalId: matched.group.internalId,
      fixture: matched.group.fixture,
      providerFixtures: matched.group.providerFixtures,
      providerIds: matched.group.providerIds,
      discrepancies: matched.group.discrepancies,
      providerAgreement: this.consensus.agreement(matched.group),
      providers: this.health.all(),
      disclaimer: BET_DISCLAIMER,
    };
  }

  async analyze(id: string, useOpenAi = true): Promise<NormalizedAnalysis> {
    const matched = await this.find(id);
    const fixture = matched.group.fixture;
    const [home, away] = await Promise.all([
      loadTeamSnapshot(fixture.homeTeam.id ?? fixture.homeTeam.name, fixture.homeTeam.name),
      loadTeamSnapshot(fixture.awayTeam.id ?? fixture.awayTeam.name, fixture.awayTeam.name),
    ]);
    const providerAgreement = this.consensus.agreement(matched.group);
    const base = this.statistics.build(
      fixture,
      home,
      away,
      matched.results.flatMap((result) => result.results),
      matched.results.flatMap((result) => result.teamStatistics),
      matched.results.flatMap((result) => result.standings),
    );
    base.providerConsensus = providerAgreement;
    base.odds = matched.results.flatMap((result) => result.odds);
    base.modelProbabilities = this.engine.calculate(base, home, away, providerAgreement);
    if (useOpenAi) {
      const openAi = await this.openAi.analyze(base);
      if (openAi) base.openAi = openAi;
    }
    this.generated.set(fixture.internalId, {
      generatedAt: new Date().toISOString(),
      predictions: base.modelProbabilities,
    });
    await this.persistence.savePrediction(base, base.modelProbabilities);
    return base;
  }

  async top(query: PredictionQuery = {}) {
    const groups = await this.collect(query);
    const eligible = groups.filter((item) => this.matchesFilters(item.fixture, query, item.providerFixtures));
    const analyses = await this.mapSettled(eligible, 3, (item) => this.analyze(item.internalId));
    const rows = analyses.flatMap((analysis) =>
      analysis.modelProbabilities
        .filter((prediction) => this.predictionMatches(prediction, analysis.fixture, { ...query, provider: undefined }))
        .map((prediction) => ({
          fixture: analysis.fixture,
          prediction,
          openAi: analysis.openAi ?? null,
        })),
    );
    rows.sort((left, right) => right.prediction.modelScore - left.prediction.modelScore);
    return {
      timezone: footballTimezone(),
      count: rows.length,
      items: rows.slice(0, 100),
      analyzedFixtures: analyses.length,
      providers: this.health.all(),
      disclaimer: BET_DISCLAIMER,
      note: 'Ranked by probability, confidence, data quality, provider agreement, consistency, and available odds/value. This is probabilistic analysis, not a guarantee.',
    };
  }

  async backtest(query: { date?: string; day?: string } = {}): Promise<BacktestReport> {
    const groups = await this.collect(query);
    const rows = groups.flatMap((item) => {
      const cached = this.groups.get(item.internalId);
      const generated = this.generated.get(item.internalId);
      const result = cached?.results
        .flatMap((provider) => provider.results)
        .find((candidate) => candidate.providerFixtureId === item.providerIds[candidate.provider]);
      if (!generated || !result) return [];
      return [{ result, predictions: generated.predictions, generatedAt: generated.generatedAt }];
    });
    const report = this.backtesting.evaluate(rows);
    const range = dateRangeForQuery(query);
    await this.persistence.saveBacktest(
      range.dateFrom ?? 'rolling',
      range.dateTo ?? 'rolling',
      report as unknown as Record<string, unknown>,
    );
    return report;
  }

  providerStatus() {
    return {
      timezone: footballTimezone(),
      providers: this.health.all(),
      disclaimer: BET_DISCLAIMER,
    };
  }

  private async collect(query: FootballFixtureQuery): Promise<MatchedFixture[]> {
    if (query.date && !validYmd(query.date)) throw new BadRequestException('date must use YYYY-MM-DD');
    if (query.day && !['all', 'all days', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(query.day.toLowerCase())) {
      throw new BadRequestException('day must be All Days or a weekday');
    }
    if (query.provider && !['sportmonks', 'apiFootball', 'footballDataOrg'].includes(query.provider)) {
      throw new BadRequestException('provider must be sportmonks, apiFootball, or footballDataOrg');
    }
    const range = dateRangeForQuery(query);
    const from = range.dateFrom ?? new Date().toISOString().slice(0, 10);
    const to = range.dateTo ?? this.plusDays(from, 14);
    const options: ProviderFetchOptions = { dateFrom: from, dateTo: to, timezone: range.timezone };
    const cacheKey = `${from}:${to}:${range.timezone}`;
    const cacheHit = this.providerCache.get(cacheKey);
    const results = cacheHit && Date.now() - cacheHit.at < FootballAnalysisService.PROVIDER_CACHE_TTL_MS
      ? cacheHit.results
      : await Promise.all(this.adapters.map((adapter) => adapter.fetch(options)));
    if (!cacheHit || Date.now() - cacheHit.at >= FootballAnalysisService.PROVIDER_CACHE_TTL_MS) {
      this.providerCache.set(cacheKey, { results, at: Date.now() });
      results.forEach((result) => this.health.update(result.health));
      await this.persistence.saveSyncResults(results);
    }
    const configured = results.filter((result) => result.health.status !== 'disabled');
    const allFixtures = results.flatMap((result) => result.fixtures);
    if (!configured.length) {
      throw new BadGatewayException('No football data provider is configured. Add at least one server-side provider API key.');
    }
    if (!allFixtures.length && configured.every((result) => result.health.status === 'error')) {
      throw new BadGatewayException('All configured football providers failed. No football data was fabricated.');
    }
    const matched = this.matcher.match(allFixtures);
    matched.forEach((group) => this.groups.set(group.internalId, { group, results, syncedAt: Date.now() }));
    await this.persistence.saveFixtures(matched);
    return matched;
  }

  private async find(id: string): Promise<{ group: MatchedFixture; results: ProviderFetchResult[] }> {
    const cached = this.groups.get(id);
    if (cached) return cached;
    const groups = await this.collect({});
    const hit = groups.find((item) => item.internalId === id || Object.values(item.providerIds).includes(id) || Object.values(item.providerIds).some((value) => `${item.fixture.provider}:${value}` === id));
    if (!hit) throw new NotFoundException('Football fixture not found');
    const result = this.groups.get(hit.internalId);
    if (!result) throw new NotFoundException('Football fixture not found');
    return result;
  }

  private matchesFilters(
    fixture: NormalizedFixture,
    query: FootballFixtureQuery,
    providerFixtures?: Partial<Record<FootballProviderName, NormalizedFixture>>,
  ): boolean {
    if (query.league && !(fixture.leagueName ?? '').toLowerCase().includes(query.league.toLowerCase())) return false;
    if (query.provider && !Object.keys(providerFixtures ?? { [fixture.provider]: fixture }).includes(query.provider)) return false;
    return true;
  }

  private predictionMatches(prediction: MarketPrediction, fixture: NormalizedFixture, query: PredictionQuery): boolean {
    if (!this.matchesFilters(fixture, query)) return false;
    if (query.minimumProbability != null && prediction.probability < query.minimumProbability) return false;
    if (query.minimumConfidence != null && prediction.confidence < query.minimumConfidence) return false;
    if (query.market && prediction.market.toLowerCase() !== query.market.toLowerCase()) return false;
    if (query.risk && prediction.risk !== query.risk) return false;
    return true;
  }

  private plusDays(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }

  private async mapSettled<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const output: R[] = [];
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        try {
          output.push(await fn(items[index]!));
        } catch (error) {
          this.logger.warn(`Football analysis skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return output;
  }
}
