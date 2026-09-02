import { fetchWithTimeout } from '@memecoinbot/data-providers';
import {
  isPopularTeam,
  isListedFootball,
  foldName,
  leagueCountry,
  leagueHeading,
  countryFlag,
  isTopLeague,
} from './popular';
import { snapshotFromRows } from './matchStats';
import {
  indexFotmobDirectory,
  lookupFotmobId,
  mergeFotmobRows,
  rowsFromFotmobFixtures,
  rowsFromFotmobForm,
  teamsFromLeaguePayload,
  type FotmobFixture,
  type FotmobFormItem,
} from './fotmob';
import type { FixtureSummary, LineupInfo, TeamMatchRow, TeamSnapshot } from './types';
import {
  eventsFromFotmobMatches,
  eventsFromLivescoreApp,
  eventsFromSofascoreLive,
  eventsFromSofascoreScheduled,
  fetchJsonNoAds,
  type LiveFeedEvent,
} from './liveFeeds';
import { footballTimezone, localDate } from './football-data.utils';
import { ApiFootballProvider } from './api-football.provider';
import { FootballDataOrgProvider } from './football-data-org.provider';
import { SportmonksProvider } from './sportmonks.provider';
import type { NormalizedFixture, ProviderFetchOptions, ProviderFetchResult } from './football-data.types';
import { FOTMOB_LEAGUE_IDS, FOTMOB_LEAGUE_COUNTRY } from './fotmob-league-ids';

const TSDB = 'https://www.thesportsdb.com/api/v1/json/3';
const FD = 'https://api.football-data.org/v4';
const FOTMOB = 'https://www.fotmob.com';
const FOTMOB_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};
const FOTMOB_LEAGUES = FOTMOB_LEAGUE_IDS;

const TSDB_LEAGUES: Array<{ id: string; name: string }> = [
  { id: '4328', name: 'English Premier League' },
  { id: '4329', name: 'English Championship' },
  { id: '4330', name: 'Scottish Premiership' },
  { id: '4331', name: 'German Bundesliga' },
  { id: '4332', name: 'Italian Serie A' },
  { id: '4334', name: 'French Ligue 1' },
  { id: '4335', name: 'Spanish La Liga' },
  { id: '4336', name: 'Greek Super League' },
  { id: '4337', name: 'Dutch Eredivisie' },
  { id: '4338', name: 'Belgian Pro League' },
  { id: '4339', name: 'Turkish Super Lig' },
  { id: '4340', name: 'Danish Superliga' },
  { id: '4480', name: 'UEFA Champions League' },
  { id: '4481', name: 'UEFA Europa League' },
  { id: '4482', name: 'FA Cup' },
  { id: '4570', name: 'EFL Cup' },
  { id: '4344', name: 'Portuguese Primeira Liga' },
  { id: '4346', name: 'Brazilian Serie A' },
  { id: '4347', name: 'Swedish Allsvenskan' },
  { id: '4350', name: 'Mexican Liga MX' },
  { id: '4351', name: 'Argentine Primera Division' },
  { id: '4354', name: 'Ukrainian Premier League' },
  { id: '4355', name: 'Russian Premier League' },
  { id: '4356', name: 'Australian A-League' },
  { id: '4358', name: 'Norwegian Eliteserien' },
  { id: '4359', name: 'Chinese Super League' },
  { id: '4422', name: 'Polish Ekstraklasa' },
  { id: '4394', name: 'Indian Super League' },
  { id: '4406', name: 'Qatar Stars League' },
];

type CacheEntry<T> = { at: number; data: T; ttl?: number };
const cache = new Map<string, CacheEntry<unknown>>();
const TTL = 8 * 60 * 1000;
const EMPTY_TTL = 45 * 1000;
const OFFICIAL_PROVIDERS = [
  new SportmonksProvider(),
  new ApiFootballProvider(),
  new FootballDataOrgProvider(),
];

function cached<T>(key: string, ttl = TTL): T | null {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (!hit) return null;
  if (Date.now() - hit.at > (hit.ttl ?? ttl)) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache<T>(key: string, data: T, ttl?: number) {
  cache.set(key, { at: Date.now(), data, ttl });
}

async function mapBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const settled = await Promise.allSettled(chunk.map(fn));
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(...r.value);
    }
  }
  return out;
}

type RawEvent = {
  id: string;
  league: string;
  kickoffUtc: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  venue?: string;
  status: string;
  live?: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
  minute?: string;
  country?: string;
};

function canonTeam(name: string): string {
  return foldName(name)
    .replace(/\b(fc|cf|afc|sc|ac|ssc|ud|cd|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function eventMatchKey(home: string, away: string, kickoffUtc: string): string {
  return `${canonTeam(home)}|${canonTeam(away)}|${kickoffUtc.slice(0, 10)}`;
}

function matchKey(home: string, away: string, kickoffUtc: string): string {
  return eventMatchKey(home, away, kickoffUtc);
}

export function isLiveStatus(status: string | undefined): boolean {
  return /^(in.?play|live|1h|2h|ht|et|pen|paused|half)/i.test((status ?? '').trim());
}

export function dedupeEvents(events: RawEvent[]): RawEvent[] {
  const byId = new Map<string, RawEvent>();
  for (const event of events) {
    const previous = byId.get(event.id);
    byId.set(event.id, previous ? mergeEvents(previous, event) : event);
  }
  const map = new Map<string, RawEvent>();
  for (const e of byId.values()) {
    const k = matchKey(e.homeName, e.awayName, e.kickoffUtc);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, e);
      continue;
    }
    map.set(k, mergeEvents(prev, e));
  }
  return [...map.values()].sort((a, b) => {
    if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
    return a.kickoffUtc.localeCompare(b.kickoffUtc);
  });
}

function mergeEvents(previous: RawEvent, next: RawEvent): RawEvent {
  const preferNext =
    (next.live && !previous.live) ||
    (next.id.startsWith('fd_') && !previous.id.startsWith('fd_') && !previous.live) ||
    (next.homeScore != null && previous.homeScore == null);
  const preferred = preferNext ? next : previous;
  return {
    ...previous,
    ...preferred,
    homeName: next.homeName.length > previous.homeName.length ? next.homeName : previous.homeName,
    awayName: next.awayName.length > previous.awayName.length ? next.awayName : previous.awayName,
    live: Boolean(previous.live || next.live),
    homeScore: next.homeScore ?? previous.homeScore,
    awayScore: next.awayScore ?? previous.awayScore,
    minute: next.minute ?? previous.minute,
    venue: next.venue ?? previous.venue,
  };
}

function upcoming(e: RawEvent): boolean {
  if (e.live || isLiveStatus(e.status)) return true;
  const t = Date.parse(e.kickoffUtc);
  if (!Number.isFinite(t)) return true;
  return t >= Date.now() - 150 * 60 * 1000;
}

function onDefaultFixtureBoard(e: RawEvent): boolean {
  if (upcoming(e)) return true;
  return localDate(e.kickoffUtc, footballTimezone()) === localDate(new Date().toISOString(), footballTimezone());
}

export function footballDataConfigured(): boolean {
  return Boolean((process.env.FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_DATA_TOKEN)?.trim());
}

export function oddsApiConfigured(): boolean {
  return Boolean(process.env.ODDS_API_KEY?.trim());
}

function asIsoUtc(stamp: string): string {
  const t = Date.parse(stamp);
  if (!Number.isFinite(t)) return stamp;
  return new Date(t).toISOString();
}

export function toFixtureSummary(e: RawEvent): FixtureSummary {
  const homePop = isPopularTeam(e.homeName);
  const awayPop = isPopularTeam(e.awayName);
  const live = Boolean(e.live || isLiveStatus(e.status));
  const country = leagueCountry(e.league, e.country);
  return {
    id: e.id,
    league: e.league,
    competition: e.league,
    kickoffUtc: asIsoUtc(e.kickoffUtc),
    venue: e.venue,
    status: live ? 'LIVE' : e.status,
    home: { id: e.homeId, name: e.homeName, popular: homePop },
    away: { id: e.awayId, name: e.awayName, popular: awayPop },
    popularMatch: homePop || awayPop,
    topLeague: isTopLeague(e.league, country),
    live,
    country,
    countryFlag: countryFlag(country),
    leagueHeading: leagueHeading(e.league, country),
    score:
      e.homeScore != null || e.awayScore != null
        ? { home: e.homeScore ?? null, away: e.awayScore ?? null }
        : undefined,
    minute: e.minute,
  };
}

function tsdbKickoff(ev: Record<string, string | null>): string | null {
  const stamp = ev.strTimestamp?.trim();
  if (stamp) {
    if (/Z|[+-]\d{2}:?\d{2}$/.test(stamp)) return stamp.endsWith('Z') || stamp.includes('+') || stamp.includes('-', 10) ? stamp : `${stamp}Z`;
    return `${stamp}Z`;
  }
  const date = ev.dateEvent;
  if (!date) return null;
  const time = (ev.strTime ?? '12:00:00').slice(0, 8);
  return `${date}T${time}Z`;
}

function tsdbEvent(ev: Record<string, string | null>, leagueFallback: string): RawEvent | null {
  const kickoffUtc = tsdbKickoff(ev);
  if (!kickoffUtc || !ev.idEvent || !ev.strHomeTeam || !ev.strAwayTeam) return null;
  if (ev.strSport && !/soccer|football/i.test(ev.strSport)) return null;
  return {
    id: `tsdb_${ev.idEvent}`,
    league: ev.strLeague || leagueFallback,
    kickoffUtc,
    homeId: `tsdb_${ev.idHomeTeam ?? ev.strHomeTeam}`,
    homeName: ev.strHomeTeam,
    awayId: `tsdb_${ev.idAwayTeam ?? ev.strAwayTeam}`,
    awayName: ev.strAwayTeam,
    venue: ev.strVenue ?? undefined,
    status: ev.strStatus ?? 'TIMED',
    country: ev.strCountry?.trim() || undefined,
  };
}

async function tsdbJson(path: string): Promise<unknown> {
  return fetchJsonNoAds(`${TSDB}/${path}`, {}, 12000);
}

async function fetchTsdbByDay(): Promise<RawEvent[]> {
  const days = Array.from({ length: 10 }, (_, n) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  });
  return fetchTsdbEventsBetween(days[0]!, days[days.length - 1]!);
}

async function fetchTsdbEventsBetween(from: string, to: string): Promise<RawEvent[]> {
  const key = `tsdb:days:${from}:${to}`;
  const hit = cached<RawEvent[]>(key);
  if (hit) return hit;
  const days: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  for (let t = start; t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  const rows = await mapBatches(days, 3, async (day) => {
    try {
      const json = (await tsdbJson(`eventsday.php?d=${day}&s=Soccer`)) as {
        events?: Array<Record<string, string | null>>;
      };
      const out: RawEvent[] = [];
      for (const ev of json.events ?? []) {
        const row = tsdbEvent(ev, ev.strLeague ?? '');
        if (row && isListedFootball(row.league)) out.push(row);
      }
      return out;
    } catch {
      return [];
    }
  });
  const out = dedupeEvents(rows);
  setCache(key, out, out.length ? TTL : EMPTY_TTL);
  return out;
}

async function fetchTsdbNextLeagues(): Promise<RawEvent[]> {
  return mapBatches(TSDB_LEAGUES, 4, async (lg) => {
    const json = (await tsdbJson(`eventsnextleague.php?id=${lg.id}`)) as {
      events?: Array<Record<string, string | null>>;
    };
    const rows: RawEvent[] = [];
    for (const ev of json.events ?? []) {
      const row = tsdbEvent(ev, lg.name);
      if (row && isListedFootball(row.league)) rows.push(row);
    }
    return rows;
  });
}

async function fetchTsdbFixtures(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('tsdb:next');
  if (hit) return hit;
  const [next, byDay] = await Promise.all([fetchTsdbNextLeagues(), fetchTsdbByDay()]);
  const out = dedupeEvents([...next, ...byDay]).filter(upcoming);
  setCache('tsdb:next', out, out.length ? TTL : EMPTY_TTL);
  return out;
}

async function fetchOpenLigaFixtures(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('openliga:bl1');
  if (hit) return hit;
  const year = new Date().getUTCFullYear();
  const rows: RawEvent[] = [];
  for (const season of [year, year - 1]) {
    try {
      const res = await fetchWithTimeout(
        `https://api.openligadb.de/getmatchdata/bl1/${season}`,
        {},
        12000,
      );
      if (!res.ok) continue;
      const matches = (await res.json()) as Array<{
        matchID?: number;
        matchDateTimeUTC?: string;
        matchDateTime?: string;
        matchIsFinished?: boolean;
        leagueName?: string;
        team1?: { teamId?: number; teamName?: string };
        team2?: { teamId?: number; teamName?: string };
      }>;
      for (const m of matches ?? []) {
        if (m.matchIsFinished || !m.team1?.teamName || !m.team2?.teamName || !m.matchID) continue;
        const rawKick = m.matchDateTimeUTC || m.matchDateTime;
        if (!rawKick) continue;
        const kickoffUtc = /Z|[+-]\d{2}:?\d{2}$/.test(rawKick) ? rawKick : `${rawKick}Z`;
        const t = Date.parse(kickoffUtc);
        if (!Number.isFinite(t) || t > Date.now() + 21 * 24 * 60 * 60 * 1000) continue;
        rows.push({
          id: `ol_${m.matchID}`,
        league: m.leagueName || 'Bundesliga',
          kickoffUtc,
          homeId: `ol_${m.team1.teamId ?? m.team1.teamName}`,
          homeName: m.team1.teamName,
          awayId: `ol_${m.team2.teamId ?? m.team2.teamName}`,
          awayName: m.team2.teamName,
          status: 'TIMED',
          country: 'Germany',
        });
      }
      if (rows.length) break;
    } catch {
      /* try previous season */
    }
  }
  const out = dedupeEvents(rows).filter(upcoming);
  setCache('openliga:bl1', out, out.length ? TTL : EMPTY_TTL);
  return out;
}

const FD_COMPS = ['PL', 'PD', 'SA', 'BL1', 'FL1', 'DED', 'PPL', 'CL', 'EL', 'ECL'];

async function fetchFdFixtures(from: string, to: string): Promise<RawEvent[]> {
  const token = process.env.FOOTBALL_DATA_TOKEN?.trim();
  if (!token) return [];
  const key = `fd:${from}:${to}`;
  const hit = cached<RawEvent[]>(key);
  if (hit) return hit;
  const results = await Promise.allSettled(
    FD_COMPS.map(async (code) => {
      const res = await fetchWithTimeout(
        `${FD}/competitions/${code}/matches?dateFrom=${from}&dateTo=${to}`,
        { headers: { 'X-Auth-Token': token } },
        12000,
      );
      if (!res.ok) throw new Error(`football-data.org ${code} HTTP ${res.status}`);
      const json = (await res.json()) as {
        competition?: { name?: string; area?: { name?: string } };
        matches?: Array<{
          id: number;
          utcDate: string;
          status: string;
          homeTeam?: { id?: number; name?: string };
          awayTeam?: { id?: number; name?: string };
          area?: { name?: string };
        }>;
      };
      const league = json.competition?.name ?? code;
      const country = json.competition?.area?.name;
      const rows: RawEvent[] = [];
      for (const m of json.matches ?? []) {
        if (!m.homeTeam?.name || !m.awayTeam?.name) continue;
        if (!['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED'].includes(m.status)) continue;
        rows.push({
          id: `fd_${m.id}`,
          league,
          kickoffUtc: m.utcDate,
          homeId: `fd_${m.homeTeam.id ?? m.homeTeam.name}`,
          homeName: m.homeTeam.name,
          awayId: `fd_${m.awayTeam.id ?? m.awayTeam.name}`,
          awayName: m.awayTeam.name,
          status: m.status,
          live: m.status === 'IN_PLAY' || m.status === 'PAUSED',
          country: m.area?.name || country,
        });
      }
      return rows;
    }),
  );
  const out: RawEvent[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value);
  }
  const merged = dedupeEvents(out).filter(upcoming);
  setCache(key, merged);
  return merged;
}

async function fetchOfficialProviderFixtures(
  from: string,
  to: string,
): Promise<{ events: RawEvent[]; sources: string[] }> {
  const configured = OFFICIAL_PROVIDERS.filter((provider) => provider.configured());
  if (!configured.length) return { events: [], sources: [] };
  const cacheKey = `official:${from}:${to}`;
  const cachedResult = cached<{ events: RawEvent[]; sources: string[] }>(cacheKey);
  if (cachedResult) return cachedResult;
  const timezone = footballTimezone();
  const options: ProviderFetchOptions = { dateFrom: from, dateTo: to, timezone };
  const settled = await Promise.allSettled(configured.map((provider) => provider.fetch(options)));
  const events: RawEvent[] = [];
  const sources: string[] = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const providerResult: ProviderFetchResult = result.value;
    if (providerResult.fixtures.length) sources.push(providerResult.provider);
    const resultsById = new Map(
      providerResult.results.map((item) => [item.providerFixtureId, { home: item.homeGoals, away: item.awayGoals }]),
    );
    for (const fixture of providerResult.fixtures) {
      const score = resultsById.get(fixture.providerFixtureId);
      events.push({
        id: `${fixture.provider}_${fixture.providerFixtureId}`,
        league: fixture.leagueName ?? 'Football',
        kickoffUtc: fixture.kickoffUtc,
        homeId: `${fixture.provider}_${fixture.homeTeam.id ?? fixture.homeTeam.name}`,
        homeName: fixture.homeTeam.name,
        awayId: `${fixture.provider}_${fixture.awayTeam.id ?? fixture.awayTeam.name}`,
        awayName: fixture.awayTeam.name,
        venue: fixture.venue,
        status: fixture.status ?? 'TIMED',
        homeScore: score?.home ?? null,
        awayScore: score?.away ?? null,
        country: fixture.homeTeam.country,
      });
    }
  }
  const output = { events, sources };
  setCache(cacheKey, output);
  return output;
}

const LIVE_TTL = 45 * 1000;
const ODDS_SCORE_SPORTS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_netherlands_eredivisie',
  'soccer_portugal_primeira_liga',
  'soccer_turkey_super_league',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
];

function parseScore(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchTsdbLivescores(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('tsdb:live', LIVE_TTL);
  if (hit) return hit;
  try {
    const json = (await tsdbJson('livescore.php?s=Soccer')) as {
      events?: Array<Record<string, string | null>>;
    };
    const rows: RawEvent[] = [];
    for (const ev of json.events ?? []) {
      const league = ev.strLeague ?? ev.strEvent ?? '';
      if (!isListedFootball(league) && !isListedFootball(ev.strLeague ?? '')) continue;
      const date = ev.dateEvent ?? new Date().toISOString().slice(0, 10);
      const time = (ev.strTime ?? '12:00:00').slice(0, 8);
      if (!ev.idEvent || !ev.strHomeTeam || !ev.strAwayTeam) continue;
      rows.push({
        id: `tsdb_${ev.idEvent}`,
        league: ev.strLeague ?? league,
        kickoffUtc: `${date}T${time}Z`,
        homeId: `tsdb_${ev.idHomeTeam ?? ev.strHomeTeam}`,
        homeName: ev.strHomeTeam,
        awayId: `tsdb_${ev.idAwayTeam ?? ev.strAwayTeam}`,
        awayName: ev.strAwayTeam,
        status: ev.strStatus || ev.strProgress || 'LIVE',
        live: true,
        homeScore: parseScore(ev.intHomeScore),
        awayScore: parseScore(ev.intAwayScore),
        minute: ev.strProgress ?? ev.strStatus ?? undefined,
        country: ev.strCountry?.trim() || undefined,
      });
    }
    setCache('tsdb:live', rows);
    return rows;
  } catch {
    setCache('tsdb:live', []);
    return [];
  }
}

async function fetchFdLive(): Promise<RawEvent[]> {
  const token = process.env.FOOTBALL_DATA_TOKEN?.trim();
  if (!token) return [];
  const hit = cached<RawEvent[]>('fd:live', LIVE_TTL);
  if (hit) return hit;
  try {
    const res = await fetchWithTimeout(
      `${FD}/matches?status=LIVE`,
      { headers: { 'X-Auth-Token': token } },
      10000,
    );
    if (!res.ok) throw new Error(`football-data.org LIVE HTTP ${res.status}`);
    const json = (await res.json()) as {
      matches?: Array<{
        id: number;
        utcDate: string;
        status: string;
        minute?: number | string;
        competition?: { name?: string; area?: { name?: string } };
        area?: { name?: string };
        homeTeam?: { id?: number; name?: string };
        awayTeam?: { id?: number; name?: string };
        score?: {
          fullTime?: { home?: number | null; away?: number | null };
          regularTime?: { home?: number | null; away?: number | null };
        };
      }>;
    };
    const rows: RawEvent[] = [];
    for (const m of json.matches ?? []) {
      const league = m.competition?.name ?? '';
      if (!isListedFootball(league)) continue;
      if (!m.homeTeam?.name || !m.awayTeam?.name) continue;
      const hs = m.score?.regularTime?.home ?? m.score?.fullTime?.home ?? null;
      const as = m.score?.regularTime?.away ?? m.score?.fullTime?.away ?? null;
      rows.push({
        id: `fd_${m.id}`,
        league,
        kickoffUtc: m.utcDate,
        homeId: `fd_${m.homeTeam.id ?? m.homeTeam.name}`,
        homeName: m.homeTeam.name,
        awayId: `fd_${m.awayTeam.id ?? m.awayTeam.name}`,
        awayName: m.awayTeam.name,
        status: m.status,
        live: true,
        homeScore: hs,
        awayScore: as,
        minute: m.minute != null ? String(m.minute) : undefined,
        country: m.area?.name || m.competition?.area?.name,
      });
    }
    setCache('fd:live', rows);
    return rows;
  } catch {
    setCache('fd:live', []);
    return [];
  }
}

async function fetchOddsLiveScores(): Promise<RawEvent[]> {
  const key = process.env.ODDS_API_KEY?.trim();
  if (!key) return [];
  const hit = cached<RawEvent[]>('odds:live', LIVE_TTL);
  if (hit) return hit;
  const settled = await Promise.allSettled(
    ODDS_SCORE_SPORTS.map(async (sport) => {
      const url =
        `https://api.the-odds-api.com/v4/sports/${sport}/scores/?daysFrom=1` +
        `&apiKey=${encodeURIComponent(key)}`;
      const res = await fetchWithTimeout(url, {}, 10000);
      if (!res.ok) return [] as RawEvent[];
      const rows = (await res.json()) as Array<{
        id?: string;
        sport_title?: string;
        commence_time?: string;
        completed?: boolean;
        home_team?: string;
        away_team?: string;
        scores?: Array<{ name?: string; score?: string }> | null;
      }>;
      const out: RawEvent[] = [];
      for (const ev of rows) {
        if (ev.completed || !ev.scores || !ev.home_team || !ev.away_team) continue;
        const homeScore = parseScore(ev.scores.find((s) => s.name === ev.home_team)?.score);
        const awayScore = parseScore(ev.scores.find((s) => s.name === ev.away_team)?.score);
        if (homeScore == null && awayScore == null) continue;
        out.push({
          id: `odds_${ev.id ?? `${ev.home_team}_${ev.away_team}`}`,
          league: ev.sport_title ?? sport,
          kickoffUtc: ev.commence_time ?? new Date().toISOString(),
          homeId: ev.home_team,
          homeName: ev.home_team,
          awayId: ev.away_team,
          awayName: ev.away_team,
          status: 'LIVE',
          live: true,
          homeScore,
          awayScore,
        });
      }
      return out;
    }),
  );
  const all: RawEvent[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  setCache('odds:live', all);
  return all;
}

function ymdUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function asRawLive(row: LiveFeedEvent): RawEvent {
  return {
    id: row.id,
    league: row.league,
    kickoffUtc: row.kickoffUtc,
    homeId: row.homeId,
    homeName: row.homeName,
    awayId: row.awayId,
    awayName: row.awayName,
    status: row.status,
    live: Boolean(row.live),
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    minute: row.minute,
    country: row.country,
  };
}

async function fetchFotmobLeagueBoard(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('fotmob:league-board');
  if (hit) return hit;
  const rows = await mapBatches(FOTMOB_LEAGUES, 6, async (id) => {
    try {
      const payload = (await fotmobJson(`/api/data/leagues?id=${id}`)) as {
        details?: { name?: string; country?: string };
        fixtures?: { allMatches?: unknown[] };
      };
      const league = payload.details?.name;
      const matches = payload.fixtures?.allMatches;
      if (!league || !Array.isArray(matches)) return [];
      const countryCode = payload.details?.country || FOTMOB_LEAGUE_COUNTRY[id];
      return eventsFromFotmobMatches(
        { name: league, country: countryCode, ccode: countryCode, matches },
        { includeScheduled: true, includeFinished: true },
      ).map(asRawLive);
    } catch {
      return [];
    }
  });
  const horizonPast = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const horizonFuture = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const out = dedupeEvents(rows).filter((event) => {
    const kickoff = Date.parse(event.kickoffUtc);
    if (!Number.isFinite(kickoff)) return true;
    return kickoff >= horizonPast && kickoff <= horizonFuture;
  });
  setCache('fotmob:league-board', out, out.length ? TTL : EMPTY_TTL);
  return out;
}

async function fetchFotmobUpcoming(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('fotmob:upcoming');
  if (hit) return hit;
  try {
    const out = dedupeEvents(await fetchFotmobLeagueBoard()).filter(upcoming);
    setCache('fotmob:upcoming', out, out.length ? TTL : EMPTY_TTL);
    return out;
  } catch {
    setCache('fotmob:upcoming', [], EMPTY_TTL);
    return [];
  }
}

async function fetchSofascoreUpcoming(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('sofa:upcoming');
  if (hit) return hit;
  try {
    const days = Array.from({ length: 8 }, (_, n) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    });
    const rows: RawEvent[] = [];
    for (let i = 0; i < days.length; i += 3) {
      const chunk = days.slice(i, i + 3);
      const settled = await Promise.allSettled(
        chunk.map((day) =>
          fetchJsonNoAds(`https://api.sofascore.com/api/v1/sport/football/scheduled-events/${day}`, { headers: FOTMOB_HEADERS }, 12000),
        ),
      );
      for (const r of settled) {
        if (r.status === 'fulfilled') rows.push(...eventsFromSofascoreScheduled(r.value).map(asRawLive));
      }
    }
    const out = dedupeEvents(rows).filter(upcoming);
    setCache('sofa:upcoming', out, out.length ? TTL : EMPTY_TTL);
    return out;
  } catch {
    setCache('sofa:upcoming', [], EMPTY_TTL);
    return [];
  }
}

async function fetchFotmobLive(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('fotmob:live', LIVE_TTL);
  if (hit) return hit;
  try {
    const dates = [...new Set([ymdUtc(Date.now()), ymdUtc(Date.now() - 12 * 60 * 60 * 1000)])];
    const paths = dates.flatMap((date) => [`/api/matches?date=${date}`, `/api/data/matches?date=${date}`]);
    const settled = await Promise.allSettled(
      paths.map((path) => fetchJsonNoAds(`${FOTMOB}${path}`, { headers: FOTMOB_HEADERS }, 12000)),
    );
    const rows: RawEvent[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') rows.push(...eventsFromFotmobMatches(r.value).map(asRawLive));
    }
    const live = dedupeEvents(rows).filter((e) => e.live || isLiveStatus(e.status));
    setCache('fotmob:live', live);
    return live;
  } catch {
    setCache('fotmob:live', []);
    return [];
  }
}

async function fetchSofascoreLive(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('sofa:live', LIVE_TTL);
  if (hit) return hit;
  try {
    const json = await fetchJsonNoAds(
      'https://api.sofascore.com/api/v1/sport/football/events/live',
      { headers: FOTMOB_HEADERS },
      12000,
    );
    const live = eventsFromSofascoreLive(json).map(asRawLive);
    setCache('sofa:live', live);
    return live;
  } catch {
    setCache('sofa:live', []);
    return [];
  }
}

async function fetchLivescoreApp(): Promise<RawEvent[]> {
  const hit = cached<RawEvent[]>('ls:live', LIVE_TTL);
  if (hit) return hit;
  try {
    const json = await fetchJsonNoAds(
      'https://prod-cdn-public-api.livescore.com/v1/api/app/live/soccer/0',
      { headers: FOTMOB_HEADERS },
      12000,
    );
    const live = eventsFromLivescoreApp(json).map(asRawLive);
    setCache('ls:live', live);
    return live;
  } catch {
    setCache('ls:live', []);
    return [];
  }
}

export async function listLiveRaw(): Promise<{ source: string; events: RawEvent[] }> {
  const [tsdb, fd, odds, fotmob, sofa, ls] = await Promise.allSettled([
    fetchTsdbLivescores(),
    fetchFdLive(),
    fetchOddsLiveScores(),
    fetchFotmobLive(),
    fetchSofascoreLive(),
    fetchLivescoreApp(),
  ]);
  const tagged: Array<{ name: string; rows: RawEvent[] }> = [
    { name: 'thesportsdb-live', rows: tsdb.status === 'fulfilled' ? tsdb.value : [] },
    { name: 'football-data-live', rows: fd.status === 'fulfilled' ? fd.value : [] },
    { name: 'odds-api-scores', rows: odds.status === 'fulfilled' ? odds.value : [] },
    { name: 'fotmob-live', rows: fotmob.status === 'fulfilled' ? fotmob.value : [] },
    { name: 'sofascore-live', rows: sofa.status === 'fulfilled' ? sofa.value : [] },
    { name: 'livescore-live', rows: ls.status === 'fulfilled' ? ls.value : [] },
  ];
  const events = dedupeEvents(tagged.flatMap((t) => t.rows)).filter((e) => e.live || isLiveStatus(e.status));
  const sources = tagged.filter((t) => t.rows.length).map((t) => t.name);
  return { source: sources.join('+') || 'none', events };
}

export async function listLiveFixtures(): Promise<{ source: string; items: FixtureSummary[] }> {
  const [raw, scheduled] = await Promise.all([listLiveRaw(), listRawFixtures({})]);
  const items = raw.events
    .map((e) => attachLiveToTwin(e, scheduled.events))
    .map(toFixtureSummary)
    .filter((f) => isListedFootball(f.league) || isListedFootball(f.competition));
  return { source: raw.source, items };
}

export function namesClose(a: string, b: string): boolean {
  const weak = new Set(['united', 'city', 'fc', 'cf', 'afc', 'sc', 'ac', 'the', 'club', 'sporting', 'athletic']);
  const canon = (s: string) =>
    foldName(s)
      .replace(/\b(fc|cf|afc|sc|ac|ssc|ud|cd|the)\b/g, '')
      .replace(/^man u(td|nited)?$/, 'manchester united')
      .replace(/^man city$/, 'manchester city')
      .replace(/^man /, 'manchester ')
      .replace(/\bmunchen\b|\bmuenchen\b/g, 'munich')
      .replace(/\s+/g, ' ')
      .trim();
  const x = canon(a);
  const y = canon(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) {
    const shorter = x.length <= y.length ? x : y;
    if (!weak.has(shorter)) return true;
  }
  const xa = x.split(' ').filter(Boolean);
  const ya = y.split(' ').filter(Boolean);
  const uniqueX = xa.filter((t) => !weak.has(t) && t.length >= 4);
  const uniqueY = ya.filter((t) => !weak.has(t) && t.length >= 4);
  if (!uniqueX.length || !uniqueY.length) return false;
  const share = uniqueX.filter((t) => uniqueY.includes(t));
  if (!share.length) return false;
  const weakX = xa.filter((t) => weak.has(t));
  const weakY = ya.filter((t) => weak.has(t));
  if (weakX.length && weakY.length && weakX.some((t) => !weakY.includes(t))) return false;
  return true;
}

/** Resolve a live or upcoming event by id, or by home/away when feeds use different ids. */
export async function findRawEvent(id: string): Promise<RawEvent | null> {
  const [raw, live] = await Promise.all([listRawFixtures({}), listLiveRaw()]);
  const liveHit = live.events.find((e) => e.id === id);
  if (liveHit) return attachLiveToTwin(liveHit, raw.events);
  const all = dedupeEvents([...live.events.map((e) => attachLiveToTwin(e, raw.events)), ...raw.events]);
  const direct = all.find((e) => e.id === id);
  if (direct) return direct;
  const decoded = decodeURIComponent(id);
  const byId = all.find((e) => e.id === decoded);
  if (byId) return byId;
  return null;
}

export function attachLiveToTwin(live: RawEvent, scheduled: RawEvent[]): RawEvent {
  const twin = scheduled.find(
    (s) =>
      namesClose(s.homeName, live.homeName) &&
      namesClose(s.awayName, live.awayName) &&
      s.kickoffUtc.slice(0, 10) === live.kickoffUtc.slice(0, 10),
  );
  if (!twin) return live;
  return {
    ...twin,
    live: true,
    status: live.status || 'LIVE',
    homeScore: live.homeScore ?? twin.homeScore,
    awayScore: live.awayScore ?? twin.awayScore,
    minute: live.minute ?? twin.minute,
    venue: live.venue ?? twin.venue,
  };
}

export async function listRawFixtures(opts: { dateFrom?: string; dateTo?: string }): Promise<{
  source: string;
  events: RawEvent[];
  warning?: string;
}> {
  const from = opts.dateFrom ?? new Date().toISOString().slice(0, 10);
  const toDate = new Date();
  toDate.setDate(toDate.getDate() + 14);
  const to = opts.dateTo ?? toDate.toISOString().slice(0, 10);
  const datedBoard = Boolean(opts.dateFrom && opts.dateTo);
  const [official, fd, tsdb, live, openliga, fotmob, sofa] = await Promise.allSettled([
    fetchOfficialProviderFixtures(from, to),
    footballDataConfigured() ? fetchFdFixtures(from, to) : Promise.resolve([] as RawEvent[]),
    datedBoard ? fetchTsdbEventsBetween(from, to) : fetchTsdbFixtures(),
    listLiveRaw().then((r) => r.events),
    fetchOpenLigaFixtures(),
    fetchFotmobLeagueBoard(),
    fetchSofascoreUpcoming(),
  ]);
  const officialResult = official.status === 'fulfilled' ? official.value : { events: [] as RawEvent[], sources: [] as string[] };
  const officialEvents = officialResult.events;
  const fdEvents = fd.status === 'fulfilled' ? fd.value : [];
  const tsdbEvents = tsdb.status === 'fulfilled' ? tsdb.value : [];
  const liveEvents = live.status === 'fulfilled' ? live.value : [];
  const olEvents = openliga.status === 'fulfilled' ? openliga.value : [];
  const fotmobEvents = fotmob.status === 'fulfilled' ? fotmob.value : [];
  const sofaEvents = sofa.status === 'fulfilled' ? sofa.value : [];
  const mergedEvents = dedupeEvents([
    ...officialEvents,
    ...fdEvents,
    ...tsdbEvents,
    ...olEvents,
    ...fotmobEvents,
    ...sofaEvents,
    ...liveEvents,
  ]);
  // An explicit date/day request is an archive-style daily board, so keep
  // already-finished matches for that requested calendar date. The unfiltered
  // board remains upcoming-only to avoid showing stale historical fixtures.
  const allEvents = opts.dateFrom || opts.dateTo ? mergedEvents : mergedEvents.filter(onDefaultFixtureBoard);
  const events = allEvents.filter((event) => {
    const day = localDate(event.kickoffUtc, footballTimezone());
    return (!opts.dateFrom || day >= opts.dateFrom) && (!opts.dateTo || day <= opts.dateTo);
  });
  const sources: string[] = [];
  sources.push(...officialResult.sources);
  if (fdEvents.length) sources.push('football-data.org');
  if (tsdbEvents.length) sources.push('thesportsdb');
  if (olEvents.length) sources.push('openligadb');
  if (fotmobEvents.length) sources.push('fotmob');
  if (sofaEvents.length) sources.push('sofascore');
  if (liveEvents.length) sources.push('livescore');
  if (!events.length) {
    const warn =
      (fd.status === 'rejected' && fd.reason instanceof Error ? fd.reason.message : '') ||
      (tsdb.status === 'rejected' && tsdb.reason instanceof Error ? tsdb.reason.message : '') ||
      'Fixture feed returned no upcoming matches. Try again shortly.';
    return { source: 'none', events: [], warning: warn };
  }
  return {
    source: sources.join('+'),
    events,
  };
}

export async function listFixtures(opts: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ source: string; items: FixtureSummary[]; warning?: string }> {
  const raw = await listRawFixtures(opts);
  return { source: raw.source, items: raw.events.map(toFixtureSummary), warning: raw.warning };
}

async function tsdbTeamIdByName(name: string): Promise<string | null> {
  const queries = [
    name.trim(),
    name.replace(/\b(fc|cf|afc|sc|ac|ssc|ud|cd)\b/gi, '').replace(/\s+/g, ' ').trim(),
  ].filter((q, i, arr) => q.length >= 3 && arr.indexOf(q) === i);
  for (const q of queries) {
    const key = `tsdbname:${q.toLowerCase()}`;
    const hit = cached<string>(key, 24 * 60 * 60 * 1000);
    if (hit && hit !== '-') return hit;
    if (hit === '-') continue;
    try {
      const json = (await tsdbJson(`searchteams.php?t=${encodeURIComponent(q)}`)) as {
        teams?: Array<{ idTeam?: string; strTeam?: string; strSport?: string }>;
      };
      const team =
        json.teams?.find((t) => (t.strSport ?? '').toLowerCase() === 'soccer') ?? json.teams?.[0];
      const id = team?.idTeam ?? null;
      setCache(key, id ?? '-');
      if (id) return id;
    } catch {
      setCache(key, '-');
    }
  }
  return null;
}

function parseGoalNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,\n]/)
    .map((s) => s.replace(/^\s*\d+['’:]+\s*/, '').replace(/\s*\(.*\)\s*$/, '').trim())
    .filter((s) => s.length > 1 && !/^\d+$/.test(s));
}

async function snapshotFromTsdbResults(
  teamId: string,
  name: string,
  numericId: string,
): Promise<TeamSnapshot | null> {
  const json = (await tsdbJson(`eventslast.php?id=${numericId}`)) as {
    results?: Array<Record<string, string | null>>;
  };
  let results = json.results ?? [];
  if (results.length < 5) {
    const extra = await tsdbPastForTeam(name, numericId);
    const seen = new Set(results.map((e) => e.idEvent));
    for (const ev of extra) {
      if (!seen.has(ev.idEvent)) results.push(ev);
    }
  }
  if (!results.length) return null;
  const rows: TeamMatchRow[] = [];
  for (const ev of results.slice(0, 10)) {
    const home = ev.strHomeTeam === name || String(ev.idHomeTeam) === numericId;
    const hs = Number(ev.intHomeScore);
    const as = Number(ev.intAwayScore);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const scorers = parseGoalNames(home ? ev.strHomeGoalDetails : ev.strAwayGoalDetails);
    rows.push({
      isHome: home,
      gf: home ? hs : as,
      ga: home ? as : hs,
      opponent: home ? ev.strAwayTeam ?? 'unknown' : ev.strHomeTeam ?? 'unknown',
      scorers: scorers.length ? scorers : undefined,
    });
  }
  if (!rows.length) return null;
  return snapshotFromRows(teamId, name, isPopularTeam(name), rows);
}

async function tsdbPastForTeam(name: string, numericId: string): Promise<Array<Record<string, string | null>>> {
  const key = `tsdbpast:${numericId}`;
  const hit = cached<Array<Record<string, string | null>>>(key, 6 * 60 * 60 * 1000);
  if (hit) return hit;
  const out: Array<Record<string, string | null>> = [];
  const settled = await Promise.allSettled(
    TSDB_LEAGUES.slice(0, 8).map(async (lg) => {
      const json = (await tsdbJson(`eventspastleague.php?id=${lg.id}`)) as {
        events?: Array<Record<string, string | null>>;
      };
      return json.events ?? [];
    }),
  );
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const ev of r.value) {
      if (String(ev.idHomeTeam) === numericId || String(ev.idAwayTeam) === numericId) out.push(ev);
      else if (ev.strHomeTeam === name || ev.strAwayTeam === name) out.push(ev);
    }
  }
  setCache(key, out);
  return out;
}

type FdMatch = {
  homeTeam?: { id?: number; name?: string };
  awayTeam?: { id?: number; name?: string };
  score?: { fullTime?: { home?: number | null; away?: number | null } };
  goals?: Array<{ scorer?: { name?: string | null }; team?: { id?: number; name?: string } }>;
};

async function fdFinishedMatches(numericId: string, extra = ''): Promise<FdMatch[]> {
  const token = process.env.FOOTBALL_DATA_TOKEN?.trim();
  if (!token) return [];
  const qs = `status=FINISHED&limit=15${extra}`;
  const res = await fetchWithTimeout(
    `${FD}/teams/${numericId}/matches?${qs}`,
    { headers: { 'X-Auth-Token': token } },
    10000,
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { matches?: FdMatch[] };
  return json.matches ?? [];
}

async function snapshotFromFd(teamId: string, name: string, numericId: string): Promise<TeamSnapshot | null> {
  const token = process.env.FOOTBALL_DATA_TOKEN?.trim();
  if (!token) return null;
  let matches = await fdFinishedMatches(numericId);
  if (matches.length < 5) {
    const prev = await fdFinishedMatches(numericId, `&season=${new Date().getUTCFullYear() - 1}`);
    const seen = new Set(matches.map((m) => `${m.homeTeam?.id}-${m.awayTeam?.id}-${m.score?.fullTime?.home}`));
    for (const m of prev) {
      const k = `${m.homeTeam?.id}-${m.awayTeam?.id}-${m.score?.fullTime?.home}`;
      if (!seen.has(k)) matches.push(m);
    }
  }
  if (!matches.length) return null;
  const rows: TeamMatchRow[] = [];
  for (const m of matches.slice(0, 10)) {
    const hs = m.score?.fullTime?.home;
    const as = m.score?.fullTime?.away;
    if (hs == null || as == null) continue;
    const isHome = String(m.homeTeam?.id) === numericId || m.homeTeam?.name === name;
    const scorers = (m.goals ?? [])
      .filter((g) => String(g.team?.id ?? '') === numericId || g.team?.name === name)
      .map((g) => g.scorer?.name)
      .filter((n): n is string => Boolean(n));
    rows.push({
      isHome,
      gf: isHome ? hs : as,
      ga: isHome ? as : hs,
      opponent: (isHome ? m.awayTeam?.name : m.homeTeam?.name) ?? 'unknown',
      scorers: scorers.length ? scorers : undefined,
    });
  }
  if (!rows.length) return null;
  return snapshotFromRows(teamId, name, isPopularTeam(name), rows);
}

export async function loadTeamSnapshot(teamId: string, name: string): Promise<TeamSnapshot> {
  const key = `team:${teamId}:${name}`;
  const hit = cached<TeamSnapshot>(key, 30 * 60 * 1000);
  if (hit) return hit;
  const empty: TeamSnapshot = {
    id: teamId,
    name,
    popular: isPopularTeam(name),
    last5: '',
    last10: '',
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    sampleSize: 0,
    dataReliability: 'UNKNOWN',
    recent: [],
  };
  try {
    let best: TeamSnapshot | null = await snapshotFromFotmob(teamId, name);
    if (teamId.startsWith('fd_') && (!best || (best.sampleSize ?? 0) < 5)) {
      const numeric = teamId.replace(/^fd_/, '');
      if (/^\d+$/.test(numeric)) {
        const snap = await snapshotFromFd(teamId, name, numeric);
        if (snap && (snap.sampleSize ?? 0) > (best?.sampleSize ?? 0)) best = snap;
      }
    }
    if (!best || (best.sampleSize ?? 0) < 5) {
      let numeric = teamId.replace(/^tsdb_/, '').replace(/^fd_/, '');
      if (!/^\d+$/.test(numeric) || teamId.startsWith('fd_') || teamId.startsWith('ol_') || teamId.startsWith('odds_')) {
        numeric = (await tsdbTeamIdByName(name)) ?? numeric;
      }
      if (/^\d+$/.test(numeric)) {
        const tsdb = await snapshotFromTsdbResults(teamId, name, numeric);
        if (tsdb && (tsdb.sampleSize ?? 0) > (best?.sampleSize ?? 0)) best = tsdb;
      }
    }
    if (best) {
      setCache(key, best, 30 * 60 * 1000);
      return best;
    }
  } catch {
    /* empty */
  }
  setCache(key, empty, EMPTY_TTL);
  return empty;
}

async function fotmobJson(path: string): Promise<unknown> {
  return fetchJsonNoAds(`${FOTMOB}${path}`, { headers: FOTMOB_HEADERS }, 12000);
}

async function fotmobDirectory(): Promise<Map<string, string>> {
  const hit = cached<Array<[string, string]>>('fotmob:dir', 6 * 60 * 60 * 1000);
  if (hit) return new Map(hit);
  const teams: Array<{ id: string; name: string; shortName?: string }> = [];
  const settled = await Promise.allSettled(FOTMOB_LEAGUES.map((id) => fotmobJson(`/api/data/leagues?id=${id}`)));
  for (const r of settled) {
    if (r.status === 'fulfilled') teams.push(...teamsFromLeaguePayload(r.value));
  }
  const dir = indexFotmobDirectory(teams);
  setCache('fotmob:dir', [...dir.entries()], 6 * 60 * 60 * 1000);
  return dir;
}

async function snapshotFromFotmob(teamId: string, name: string): Promise<TeamSnapshot | null> {
  try {
    const dir = await fotmobDirectory();
    const fotId = lookupFotmobId(name, dir);
    if (!fotId) return null;
    const json = (await fotmobJson(`/api/data/teams?id=${fotId}`)) as {
      fixtures?: { allFixtures?: { fixtures?: FotmobFixture[] } };
      overview?: { teamForm?: FotmobFormItem[] };
    };
    const fixtures = json.fixtures?.allFixtures?.fixtures ?? [];
    const form = json.overview?.teamForm ?? [];
    const rows = mergeFotmobRows(rowsFromFotmobFixtures(fotId, fixtures), rowsFromFotmobForm(fotId, form));
    if (!rows.length) return null;
    return snapshotFromRows(teamId, name, isPopularTeam(name), rows);
  } catch {
    return null;
  }
}

export async function loadLineup(eventId: string): Promise<LineupInfo> {
  const id = eventId.replace(/^(tsdb_|fd_)/, '');
  const unknown: LineupInfo = {
    confirmed: false,
    homeXi: [],
    awayXi: [],
    missingHome: [],
    missingAway: [],
    rotationRisk: 'UNKNOWN',
    note: 'Official XI not in feed yet. Scores will be recalculated when a confirmed line-up is available.',
  };
  if (!eventId.startsWith('tsdb_')) return unknown;
  const key = `xi:${id}`;
  const hit = cached<LineupInfo>(key, 5 * 60 * 1000);
  if (hit) return hit;
  try {
    const json = (await tsdbJson(`lookuplineup.php?id=${id}`)) as {
      lineup?: Array<{ strHome?: string; strAway?: string; strPosition?: string }>;
    };
    const rows = json.lineup ?? [];
    const homeXi = rows.map((r) => r.strHome).filter((x): x is string => Boolean(x));
    const awayXi = rows.map((r) => r.strAway).filter((x): x is string => Boolean(x));
    const confirmed = homeXi.length >= 11 && awayXi.length >= 11;
    const info: LineupInfo = {
      confirmed,
      homeXi: homeXi.slice(0, 11),
      awayXi: awayXi.slice(0, 11),
      missingHome: [],
      missingAway: [],
      rotationRisk: confirmed ? 'LOW' : 'UNKNOWN',
      note: confirmed
        ? 'Confirmed XI loaded. Safety and market scores use this line-up.'
        : unknown.note,
    };
    setCache(key, info);
    return info;
  } catch {
    setCache(key, unknown);
    return unknown;
  }
}

export function findRaw(events: RawEvent[], id: string): RawEvent | undefined {
  return events.find((e) => e.id === id);
}

export type { RawEvent };
