import { Injectable } from '@nestjs/common';
import { fixtureFromFields, leagueFromProvider, resultFromFixture } from './football-data.normalizer';
import { emptyProviderResult, getJson } from './football-data.utils';
import type {
  FootballProviderAdapter,
  NormalizedFixture,
  ProviderFetchOptions,
  ProviderFetchResult,
  ProviderHealth,
} from './football-data.types';

@Injectable()
export class ApiFootballProvider implements FootballProviderAdapter {
  readonly name = 'apiFootball' as const;
  private readonly baseUrl = (process.env.API_FOOTBALL_BASE_URL?.trim() || 'https://v3.football.api-sports.io').replace(/\/$/, '');

  configured(): boolean {
    return Boolean(process.env.API_FOOTBALL_KEY?.trim());
  }

  async fetch(options: ProviderFetchOptions): Promise<ProviderFetchResult> {
    const key = process.env.API_FOOTBALL_KEY?.trim();
    if (!key) return emptyProviderResult(this.name, false);
    const started = Date.now();
    try {
      const params = new URLSearchParams({ from: options.dateFrom, to: options.dateTo });
      const result = await getJson(`${this.baseUrl}/fixtures?${params.toString()}`, {
        headers: { 'x-apisports-key': key },
      }, 15000);
      if (!result.response.ok) throw new Error(`API-Football HTTP ${result.response.status}`);
      const rows = this.asArray(result.body);
      const fixtures: NormalizedFixture[] = [];
      const results = [];
      const leagues = [];
      for (const value of rows) {
        const row = this.record(value);
        const fixture = this.record(row.fixture);
        const teams = this.record(row.teams);
        const league = this.record(row.league);
        const goals = this.record(row.goals);
        const score = this.record(row.score);
        const normalized = fixtureFromFields({
          provider: this.name,
          fixtureId: fixture.id,
          date: fixture.date,
          home: teams.home,
          away: teams.away,
          leagueId: league.id,
          leagueName: league.name,
          season: league.season,
          status: this.record(fixture.status).short ?? this.record(fixture.status).long,
          venue: this.record(fixture.venue).name,
          timezone: options.timezone,
        });
        if (!normalized) continue;
        fixtures.push(normalized);
        const normalizedLeague = leagueFromProvider(this.name, league);
        if (normalizedLeague) leagues.push(normalizedLeague);
        const normalizedResult = resultFromFixture(normalized, goals.home, goals.away, {
          halftimeHomeGoals: this.record(score.halftime).home,
          halftimeAwayGoals: this.record(score.halftime).away,
        });
        if (normalizedResult) results.push(normalizedResult);
      }
      const health: ProviderHealth = {
        provider: this.name,
        status: 'connected',
        responseTimeMs: Date.now() - started,
        errors: 0,
        rateLimitResponses: 0,
        lastSuccessfulSync: new Date().toISOString(),
        fixturesReceived: fixtures.length,
      };
      return {
        provider: this.name,
        fixtures,
        results,
        leagues,
        standings: [],
        teamStatistics: [],
        fixtureStatistics: [],
        headToHeads: [],
        odds: [],
        health,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'API-Football request failed';
      const fallback = emptyProviderResult(this.name, true, message);
      fallback.health.responseTimeMs = Date.now() - started;
      fallback.health.rateLimitResponses = /429/.test(message) ? 1 : 0;
      return fallback;
    }
  }

  private asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && Array.isArray((value as { response?: unknown }).response)) {
      return (value as { response: unknown[] }).response;
    }
    return [];
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' ? (value as Record<string, any>) : {};
  }
}
