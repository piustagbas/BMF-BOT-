import { Injectable, Logger } from '@nestjs/common';
import {
  FootballFixtureRecord,
  FootballBacktestRecord,
  FootballEntity,
  FootballPredictionRecord,
  FootballSyncLog,
  isDbConnected,
} from '@memecoinbot/db';
import type { MarketPrediction, NormalizedAnalysis, ProviderFetchResult } from './football-data.types';
import type { MatchedFixture } from './fixture-matching.service';

@Injectable()
export class FootballPersistenceService {
  private readonly logger = new Logger(FootballPersistenceService.name);

  async saveSyncResults(results: ProviderFetchResult[]): Promise<void> {
    if (!isDbConnected()) return;
    await Promise.allSettled(
      results.map((result) =>
        FootballSyncLog.create({
          provider: result.provider,
          startedAt: result.health.lastSuccessfulSync
            ? new Date(new Date(result.health.lastSuccessfulSync).getTime() - (result.health.responseTimeMs ?? 0))
            : new Date(),
          completedAt: new Date(),
          status: result.health.status,
          responseTimeMs: result.health.responseTimeMs,
          fixturesReceived: result.health.fixturesReceived,
          errorCount: result.health.errors,
          rateLimitResponses: result.health.rateLimitResponses,
          message: result.health.message || result.warning,
        }),
      ),
    );
  }

  async saveFixtures(groups: MatchedFixture[]): Promise<void> {
    if (!isDbConnected()) return;
    const operations = groups.map((group) =>
      FootballFixtureRecord.updateOne(
        { internalId: group.internalId },
        {
          $set: {
            providerIds: group.providerIds,
            fixture: group.fixture,
            provenance: group.providerFixtures,
            lastSyncedAt: new Date(),
          },
        },
        { upsert: true },
      ),
    );
    const entityOperations = groups.flatMap((group) =>
      Object.entries(group.providerFixtures).map(([provider, fixture]) =>
        FootballEntity.updateOne(
          { entityType: 'fixture', provider, providerId: fixture.providerFixtureId },
          {
            $set: {
              internalId: group.internalId,
              data: fixture,
              observedAt: new Date(),
            },
          },
          { upsert: true },
        ),
      ),
    );
    await Promise.allSettled([...operations, ...entityOperations]);
  }

  async savePrediction(analysis: NormalizedAnalysis, predictions: MarketPrediction[]): Promise<void> {
    if (!isDbConnected()) return;
    try {
      await FootballPredictionRecord.create({
        fixtureId: analysis.fixture.internalId,
        generatedAt: new Date(),
        modelVersion: 'poisson-weighted-form-v1',
        predictions,
        openAiAnalysis: analysis.openAi ?? null,
      });
    } catch (error) {
      this.logger.warn(`Could not persist football prediction: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async saveBacktest(from: string, to: string, report: Record<string, unknown>): Promise<void> {
    if (!isDbConnected()) return;
    try {
      await FootballBacktestRecord.create({
        runId: `football-backtest:${from}:${to}:${Date.now()}`,
        from,
        to,
        report,
      });
    } catch (error) {
      this.logger.warn(`Could not persist football backtest: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
