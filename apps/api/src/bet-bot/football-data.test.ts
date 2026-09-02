import { describe, expect, it, vi } from 'vitest';
import { BacktestingService } from './backtesting.service';
import { ApiFootballProvider } from './api-football.provider';
import { FootballDataOrgProvider } from './football-data-org.provider';
import { fixtureFromFields } from './football-data.normalizer';
import { FixtureMatchingService } from './fixture-matching.service';
import { PredictionEngine } from './prediction-engine';
import { SportmonksProvider } from './sportmonks.provider';
import { dateRangeForQuery, localDate, localDay } from './football-data.utils';
import type { NormalizedAnalysis, NormalizedResult } from './football-data.types';
import type { TeamSnapshot } from './types';

function team(name: string, rows: TeamSnapshot['recent']): TeamSnapshot {
  const recent = rows ?? [];
  return {
    id: name.toLowerCase(),
    name,
    popular: false,
    last5: 'WWDWL',
    wins: 3,
    draws: 1,
    losses: 1,
    goalsFor: 8,
    goalsAgainst: 5,
    recent,
    sampleSize: recent.length,
    dataReliability: recent.length >= 8 ? 'GOOD' : 'LIMITED',
  };
}

function baseAnalysis(): NormalizedAnalysis {
  const fixture = fixtureFromFields({
    provider: 'sportmonks',
    fixtureId: 1,
    date: '2026-08-31T15:00:00Z',
    home: { id: 10, name: 'Arsenal' },
    away: { id: 20, name: 'Burnley' },
    leagueId: 1,
    leagueName: 'Premier League',
  })!;
  return {
    fixture,
    recentForm: { homeLast5: [], awayLast5: [], homeLast10: [], awayLast10: [], homeWeightedPoints: null, awayWeightedPoints: null },
    homeAwayStats: { home: null, away: null },
    h2h: { sampleSize: 0, homeWins: 0, awayWins: 0, draws: 0, averageGoals: null, bttsRate: null, over15Rate: null, over25Rate: null, over35Rate: null },
    leagueStats: { homeStanding: null, awayStanding: null, averageGoals: null, homeAdvantage: null },
    advancedStats: { xg: null, xga: null, shots: null, shotsOnTarget: null, possessionPct: null, corners: null, cards: null },
    odds: [],
    modelProbabilities: [],
    providerConsensus: { available: 3, total: 3, score: 100, label: '3/3', discrepancies: [] },
    dataQuality: 'medium',
    insufficientData: false,
  };
}

describe('football data pipeline primitives', () => {
  it('converts provider timestamps to the configured timezone and calendar day', () => {
    expect(localDate('2026-08-31T23:30:00Z', 'Africa/Lagos')).toBe('2026-09-01');
    expect(localDay('2026-08-31T23:30:00Z', 'Africa/Lagos')).toBe('tuesday');
  });

  it('gives a specific date precedence over a day filter', () => {
    expect(dateRangeForQuery({ date: '2026-08-31', day: 'sunday', timezone: 'Africa/Lagos' })).toMatchObject({
      dateFrom: '2026-08-31',
      dateTo: '2026-08-31',
    });
  });

  it('maps today and tomorrow day filters to calendar dates', () => {
    const now = new Date('2026-09-01T10:00:00Z');
    expect(dateRangeForQuery({ day: 'today', timezone: 'Africa/Lagos', now })).toMatchObject({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-01',
    });
    expect(dateRangeForQuery({ day: 'tomorrow', timezone: 'Africa/Lagos', now })).toMatchObject({
      dateFrom: '2026-09-02',
      dateTo: '2026-09-02',
    });
  });

  it('matches provider fixtures without merging their provider IDs', () => {
    const first = fixtureFromFields({
      provider: 'sportmonks',
      fixtureId: 100,
      date: '2026-08-31T15:00:00Z',
      home: { id: 1, name: 'AFC Bournemouth' },
      away: { id: 2, name: 'Everton FC' },
      leagueName: 'Premier League',
    })!;
    const second = fixtureFromFields({
      provider: 'apiFootball',
      fixtureId: 200,
      date: '2026-08-31T15:02:00Z',
      home: { id: 3, name: 'Bournemouth' },
      away: { id: 4, name: 'Everton' },
      leagueName: 'Premier League',
    })!;
    const groups = new FixtureMatchingService().match([first, second]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.providerIds).toEqual({ sportmonks: '100', apiFootball: '200' });
  });

  it('returns no mathematical market when either team lacks a historical sample', () => {
    const analysis = baseAnalysis();
    const rows = [{ isHome: true, gf: 2, ga: 0, opponent: 'A' }, { isHome: false, gf: 1, ga: 1, opponent: 'B' }];
    expect(new PredictionEngine().calculate(analysis, team('Arsenal', rows), team('Burnley', rows))).toEqual([]);
  });

  it('calculates bounded probabilities and uses available odds for value', () => {
    const analysis = baseAnalysis();
    analysis.odds = [{
      provider: 'footballDataOrg',
      fixtureId: '1',
      market: 'TOTALS',
      selection: 'OVER_1.5',
      decimalOdds: 1.8,
      capturedAt: '2026-08-31T12:00:00Z',
      source: { provider: 'footballDataOrg', fetchedAt: '2026-08-31T12:00:00Z' },
    }];
    const rows = Array.from({ length: 5 }, (_, index) => ({ isHome: index % 2 === 0, gf: 2, ga: 1, opponent: `Team ${index}` }));
    const predictions = new PredictionEngine().calculate(analysis, team('Arsenal', rows), team('Burnley', rows));
    expect(predictions.length).toBeGreaterThan(0);
    expect(predictions.every((row) => row.probability >= 0 && row.probability <= 100 && row.confidence < 100)).toBe(true);
    expect(predictions.find((row) => row.selection === 'OVER_1.5')?.impliedProbability).toBeCloseTo(55.6, 1);
  });

  it('evaluates only pre-kickoff predictions in backtests', () => {
    const analysis = baseAnalysis();
    const rows = Array.from({ length: 5 }, (_, index) => ({ isHome: index % 2 === 0, gf: 2, ga: 1, opponent: `Team ${index}` }));
    const predictions = new PredictionEngine().calculate(analysis, team('Arsenal', rows), team('Burnley', rows));
    const prediction = predictions.find((row) => row.market === 'TOTALS' && row.selection === 'OVER_1.5')!;
    const result: NormalizedResult = { ...analysis.fixture, homeGoals: 2, awayGoals: 1 };
    const report = new BacktestingService().evaluate([
      { result, predictions: [prediction], generatedAt: '2026-08-31T12:00:00Z' },
      { result, predictions: [prediction], generatedAt: '2026-08-31T16:00:00Z' },
    ]);
    expect(report.predictions).toBe(1);
    expect(report.accuracy).toBe(100);
  });

  it('disables each official provider cleanly when its server key is absent', async () => {
    const keys = ['SPORTMONKS_API_TOKEN', 'API_FOOTBALL_KEY', 'FOOTBALL_DATA_API_KEY', 'FOOTBALL_DATA_TOKEN'];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    const options = { dateFrom: '2026-08-31', dateTo: '2026-08-31', timezone: 'Africa/Lagos' };
    const results = await Promise.all([
      new SportmonksProvider().fetch(options),
      new ApiFootballProvider().fetch(options),
      new FootballDataOrgProvider().fetch(options),
    ]);
    expect(results.map((result) => result.health.status)).toEqual(['disabled', 'disabled', 'disabled']);
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('fetches and normalizes the configured Sportmonks season standings endpoint', async () => {
    const previous = process.env.SPORTMONKS_API_TOKEN;
    const calls: string[] = [];
    process.env.SPORTMONKS_API_TOKEN = 'test-sportmonks-token';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        data: [{
          id: 55,
          position: 1,
          points: 12,
          played: 5,
          won: 4,
          draw: 0,
          lost: 1,
          participant: { id: 99, name: 'Arsenal' },
          details: [],
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    try {
      const standings = await new SportmonksProvider().fetchSeasonStandings('28083');
      expect(calls[0]).toContain('/standings/seasons/28083');
      expect(calls[0]).toContain('include=participant;rule.type;details.type;form;stage;league;group');
      expect(standings[0]).toMatchObject({
        provider: 'sportmonks',
        position: 1,
        points: 12,
        team: { id: '99', name: 'Arsenal' },
      });
    } finally {
      vi.unstubAllGlobals();
      if (previous == null) delete process.env.SPORTMONKS_API_TOKEN;
      else process.env.SPORTMONKS_API_TOKEN = previous;
    }
  });
});
