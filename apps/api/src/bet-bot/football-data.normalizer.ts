import { localDate, localDateTime, numberValue, sourceId, stringValue, toUtcIso } from './football-data.utils';
import type {
  FootballProviderName,
  NormalizedFixture,
  NormalizedLeagueSeason,
  NormalizedResult,
  NormalizedStanding,
  NormalizedTeam,
  SourceRef,
} from './football-data.types';

export function teamFromProvider(
  provider: FootballProviderName,
  value: unknown,
  fallbackName = 'Unknown team',
  fetchedAt = new Date().toISOString(),
): NormalizedTeam {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const name =
    stringValue(row.name) ||
    stringValue(row.short_name) ||
    stringValue(row.display_name) ||
    stringValue(row.team_name) ||
    fallbackName;
  const id = row.id ?? row.team_id ?? row.teamId;
  const country = stringValue(row.country) || stringValue(row.country_name);
  const source: SourceRef = { provider, providerId: sourceId(provider, id), fetchedAt };
  return {
    id: id == null ? undefined : String(id),
    name,
    shortName: stringValue(row.short_name) || stringValue(row.shortName),
    country,
    logoUrl: stringValue(row.logo) || stringValue(row.logo_path) || stringValue(row.logoUrl),
    sources: [source],
  };
}

export function fixtureFromFields(input: {
  provider: FootballProviderName;
  fixtureId: unknown;
  date: unknown;
  home: unknown;
  away: unknown;
  leagueId?: unknown;
  leagueName?: unknown;
  season?: unknown;
  status?: unknown;
  venue?: unknown;
  timezone?: string;
  fetchedAt?: string;
}): NormalizedFixture | null {
  const kickoffUtc = toUtcIso(input.date);
  if (!kickoffUtc) return null;
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const homeTeam = teamFromProvider(input.provider, input.home, 'Unknown team', fetchedAt);
  const awayTeam = teamFromProvider(input.provider, input.away, 'Unknown team', fetchedAt);
  const providerFixtureId = input.fixtureId == null ? '' : String(input.fixtureId);
  if (!providerFixtureId || homeTeam.name === 'Unknown team' || awayTeam.name === 'Unknown team') return null;
  const timezone = input.timezone || 'Africa/Lagos';
  return {
    internalId: `${input.provider}:${providerFixtureId}`,
    provider: input.provider,
    providerFixtureId,
    leagueId: input.leagueId == null ? undefined : String(input.leagueId),
    leagueName: stringValue(input.leagueName),
    season: input.season == null ? undefined : String(input.season),
    date: localDate(kickoffUtc, timezone),
    kickoffUtc,
    kickoffLocal: localDateTime(kickoffUtc, timezone),
    timezone,
    homeTeam,
    awayTeam,
    status: stringValue(input.status),
    venue: stringValue(input.venue),
    source: { provider: input.provider, providerId: providerFixtureId, fetchedAt },
  };
}

export function resultFromFixture(
  fixture: NormalizedFixture,
  homeGoals: unknown,
  awayGoals: unknown,
  extras?: { halftimeHomeGoals?: unknown; halftimeAwayGoals?: unknown; finishedAt?: unknown },
): NormalizedResult | null {
  const home = numberValue(homeGoals);
  const away = numberValue(awayGoals);
  if (home == null || away == null || home < 0 || away < 0) return null;
  return {
    ...fixture,
    homeGoals: Math.trunc(home),
    awayGoals: Math.trunc(away),
    halftimeHomeGoals: numberValue(extras?.halftimeHomeGoals),
    halftimeAwayGoals: numberValue(extras?.halftimeAwayGoals),
    finishedAt: toUtcIso(extras?.finishedAt) ?? undefined,
  };
}

export function leagueFromProvider(
  provider: FootballProviderName,
  value: unknown,
  fetchedAt = new Date().toISOString(),
): NormalizedLeagueSeason | null {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const id = row.id ?? row.league_id ?? row.competition_id;
  const name = stringValue(row.name) || stringValue(row.league_name) || stringValue(row.competition_name);
  if (id == null || !name) return null;
  const source: SourceRef = { provider, providerId: sourceId(provider, id), fetchedAt };
  return {
    provider,
    providerLeagueId: String(id),
    providerSeasonId: row.season_id == null ? undefined : String(row.season_id),
    leagueName: name,
    country: stringValue(row.country) || stringValue(row.area),
    season: row.season == null ? undefined : String(row.season),
    source,
  };
}

export function standingFromProvider(
  provider: FootballProviderName,
  value: unknown,
  context: { leagueId?: string; season?: string; fetchedAt?: string },
): NormalizedStanding | null {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const team = teamFromProvider(provider, row.team ?? row.participant ?? row, 'Unknown team', context.fetchedAt);
  if (team.name === 'Unknown team') return null;
  return {
    provider,
    leagueId: context.leagueId,
    season: context.season,
    team,
    position: numberValue(row.position ?? row.rank),
    played: numberValue(row.played ?? row.games_played ?? row.all_played),
    wins: numberValue(row.wins ?? row.won ?? row.all_win),
    draws: numberValue(row.draws ?? row.draw ?? row.all_draw),
    losses: numberValue(row.losses ?? row.lost ?? row.all_lose),
    goalsFor: numberValue(row.goals_for ?? row.goalsFor ?? row.all_goals_for),
    goalsAgainst: numberValue(row.goals_against ?? row.goalsAgainst ?? row.all_goals_against),
    goalDifference: numberValue(row.goal_difference ?? row.goalsDiff),
    points: numberValue(row.points),
    form: stringValue(row.form),
    stage: stringValue(row.stage),
    group: stringValue(row.group),
    details: Array.isArray(row.details) ? row.details : undefined,
    source: {
      provider,
      providerId: sourceId(provider, row.team_id ?? row.id),
      fetchedAt: context.fetchedAt ?? new Date().toISOString(),
    },
  };
}
