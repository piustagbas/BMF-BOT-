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

const DEFAULT_COMPETITIONS = ['PL', 'PD', 'SA', 'BL1', 'FL1', 'DED', 'PPL', 'CL', 'EL', 'ECL'];

@Injectable()
export class FootballDataOrgProvider implements FootballProviderAdapter {
  readonly name = 'footballDataOrg' as const;
  private readonly baseUrl = (process.env.FOOTBALL_DATA_BASE_URL?.trim() || 'https://api.football-data.org/v4').replace(/\/$/, '');

  configured(): boolean {
    return Boolean((process.env.FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_DATA_TOKEN)?.trim());
  }

  async fetch(options: ProviderFetchOptions): Promise<ProviderFetchResult> {
    const token = (process.env.FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_DATA_TOKEN)?.trim();
    if (!token) return emptyProviderResult(this.name, false);
    const started = Date.now();
    try {
      const competitions = (process.env.FOOTBALL_DATA_COMPETITIONS?.split(',') ?? DEFAULT_COMPETITIONS)
        .map((code) => code.trim())
        .filter(Boolean);
      const settled = await Promise.allSettled(
        competitions.map(async (code) => {
          const params = new URLSearchParams({ dateFrom: options.dateFrom, dateTo: options.dateTo });
          const result = await getJson(`${this.baseUrl}/competitions/${encodeURIComponent(code)}/matches?${params.toString()}`, {
            headers: { 'X-Auth-Token': token },
          }, 15000);
          if (!result.response.ok) throw new Error(`football-data.org ${code} HTTP ${result.response.status}`);
          return result.body;
        }),
      );
      const fixtures: NormalizedFixture[] = [];
      const results = [];
      const leagues = [];
      for (const item of settled) {
        if (item.status !== 'fulfilled') continue;
        const payload = item.value && typeof item.value === 'object' ? item.value as Record<string, unknown> : {};
        const matches = Array.isArray(payload.matches) ? payload.matches : [];
        for (const value of matches) {
          const row = value && typeof value === 'object' ? value as Record<string, any> : {};
          const normalized = fixtureFromFields({
            provider: this.name,
            fixtureId: row.id,
            date: row.utcDate,
            home: row.homeTeam,
            away: row.awayTeam,
            leagueId: row.competition?.id,
            leagueName: row.competition?.name,
            season: row.season?.startDate || row.season?.id,
            status: row.status,
            venue: row.venue,
            timezone: options.timezone,
          });
          if (!normalized) continue;
          fixtures.push(normalized);
          const normalizedLeague = leagueFromProvider(this.name, {
            id: row.competition?.id,
            name: row.competition?.name,
            country: row.area?.name,
            season: row.season?.id,
          });
          if (normalizedLeague) leagues.push(normalizedLeague);
          const normalizedResult = resultFromFixture(normalized, row.score?.fullTime?.home, row.score?.fullTime?.away, {
            halftimeHomeGoals: row.score?.halfTime?.home,
            halftimeAwayGoals: row.score?.halfTime?.away,
          });
          if (normalizedResult) results.push(normalizedResult);
        }
      }
      const failedRequests = settled.filter((item) => item.status === 'rejected').length;
      const providerStatus = failedRequests === settled.length && settled.length > 0 ? 'error' : 'connected';
      const health: ProviderHealth = {
        provider: this.name,
        status: providerStatus,
        responseTimeMs: Date.now() - started,
        errors: failedRequests,
        rateLimitResponses: 0,
        lastSuccessfulSync: providerStatus === 'connected' ? new Date().toISOString() : null,
        fixturesReceived: fixtures.length,
        message: providerStatus === 'error' ? 'All competition requests failed' : undefined,
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
        warning: health.errors ? `${health.errors} competition requests failed` : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'football-data.org request failed';
      const fallback = emptyProviderResult(this.name, true, message);
      fallback.health.responseTimeMs = Date.now() - started;
      fallback.health.rateLimitResponses = /429/.test(message) ? 1 : 0;
      return fallback;
    }
  }
}
