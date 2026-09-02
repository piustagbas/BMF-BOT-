import { Injectable } from '@nestjs/common';
import {
  fixtureFromFields,
  leagueFromProvider,
  resultFromFixture,
  standingFromProvider,
} from './football-data.normalizer';
import { emptyProviderResult, getJson, numberValue, stringValue } from './football-data.utils';
import type {
  FootballProviderAdapter,
  NormalizedFixture,
  NormalizedStanding,
  ProviderFetchOptions,
  ProviderFetchResult,
  ProviderHealth,
} from './football-data.types';

@Injectable()
export class SportmonksProvider implements FootballProviderAdapter {
  readonly name = 'sportmonks' as const;
  private readonly baseUrl = (process.env.SPORTMONKS_BASE_URL?.trim() || 'https://api.sportmonks.com/v3/football').replace(/\/$/, '');
  private readonly standingsCache = new Map<string, { at: number; rows: NormalizedStanding[] }>();

  configured(): boolean {
    return Boolean(process.env.SPORTMONKS_API_TOKEN?.trim());
  }

  async fetch(options: ProviderFetchOptions): Promise<ProviderFetchResult> {
    const token = process.env.SPORTMONKS_API_TOKEN?.trim();
    if (!token) return emptyProviderResult(this.name, false);
    const started = Date.now();
    try {
      const url =
        `${this.baseUrl}/fixtures/between/${encodeURIComponent(options.dateFrom)}/${encodeURIComponent(options.dateTo)}` +
        `?api_token=${encodeURIComponent(token)}&include=participants;league;season;venue;scores`;
      const result = await getJson(url, {}, 15000);
      if (!result.response.ok) throw new Error(`Sportmonks HTTP ${result.response.status}`);
      const rows = this.asArray(result.body);
      const fixtures: NormalizedFixture[] = [];
      const results = [];
      const leagues = [];
      for (const value of rows) {
        const row = this.record(value);
        const participants = Array.isArray(row.participants) ? row.participants : [];
        const home = participants.find((item) => this.record(item).meta && this.record(this.record(item).meta).location === 'home') ?? participants[0];
        const away = participants.find((item) => this.record(item).meta && this.record(this.record(item).meta).location === 'away') ?? participants[1];
        const fixture = fixtureFromFields({
          provider: this.name,
          fixtureId: row.id,
          date: row.starting_at ?? row.starting_at_timestamp,
          home,
          away,
          leagueId: this.record(row.league).id ?? row.league_id,
          leagueName: this.record(row.league).name,
          season: this.record(row.season).name ?? this.record(row.season).id,
          status: this.record(row.state).name ?? row.status,
          venue: this.record(row.venue).name,
          timezone: options.timezone,
        });
        if (!fixture) continue;
        fixtures.push(fixture);
        const league = leagueFromProvider(this.name, row.league);
        if (league) leagues.push(league);
        const score = this.score(row.scores);
        const normalizedResult = resultFromFixture(fixture, score.home, score.away, {
          halftimeHomeGoals: score.halfHome,
          halftimeAwayGoals: score.halfAway,
        });
        if (normalizedResult) results.push(normalizedResult);
      }
      const seasonId = process.env.SPORTMONKS_SEASON_ID?.trim() || '28083';
      const standings = seasonId ? await this.fetchSeasonStandings(seasonId, options.timezone) : [];
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
        standings,
        teamStatistics: [],
        fixtureStatistics: [],
        headToHeads: [],
        odds: [],
        health,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sportmonks request failed';
      const fallback = emptyProviderResult(this.name, true, message);
      fallback.health.responseTimeMs = Date.now() - started;
      fallback.health.rateLimitResponses = /429/.test(message) ? 1 : 0;
      return fallback;
    }
  }

  async fetchSeasonStandings(seasonId: string, timezone = 'Africa/Lagos'): Promise<NormalizedStanding[]> {
    const token = process.env.SPORTMONKS_API_TOKEN?.trim();
    if (!token || !seasonId.trim()) return [];
    const key = `${seasonId}:${timezone}`;
    const cached = this.standingsCache.get(key);
    if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.rows;
    try {
      const url =
        `${this.baseUrl}/standings/seasons/${encodeURIComponent(seasonId.trim())}` +
        `?api_token=${encodeURIComponent(token)}` +
        '&include=participant;rule.type;details.type;form;stage;league;group';
      const result = await getJson(url, {}, 15000);
      if (!result.response.ok) throw new Error(`Sportmonks standings HTTP ${result.response.status}`);
      const fetchedAt = new Date().toISOString();
      const rows = this.asArray(result.body)
        .map((value) =>
          standingFromProvider(this.name, value, {
            leagueId: this.record(this.record(value).league).id == null
              ? undefined
              : String(this.record(this.record(value).league).id),
            season: seasonId.trim(),
            fetchedAt,
          }),
        )
        .filter((value): value is NormalizedStanding => Boolean(value));
      this.standingsCache.set(key, { at: Date.now(), rows });
      return rows;
    } catch {
      return [];
    }
  }

  private asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
      return (value as { data: unknown[] }).data;
    }
    return [];
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' ? (value as Record<string, any>) : {};
  }

  private score(value: unknown): {
    home: number | undefined;
    away: number | undefined;
    halfHome: number | undefined;
    halfAway: number | undefined;
  } {
    const scores = Array.isArray(value) ? value : [];
    let home: number | undefined;
    let away: number | undefined;
    let halfHome: number | undefined;
    let halfAway: number | undefined;
    for (const item of scores) {
      const row = this.record(item);
      const code = String(row.description ?? row.type_id ?? '').toUpperCase();
      const participant = String(row.participant ?? row.score?.participant ?? '').toLowerCase();
      const goals = numberValue(row.goals ?? row.score?.goals);
      if (goals == null) continue;
      if (code.includes('2HT') || code.includes('HALF')) {
        if (participant === 'home') halfHome = goals;
        if (participant === 'away') halfAway = goals;
      } else if (code.includes('FT') || code.includes('CURRENT') || code.includes('2ND')) {
        if (participant === 'home') home = goals;
        if (participant === 'away') away = goals;
      }
    }
    return { home, away, halfHome, halfAway };
  }
}
