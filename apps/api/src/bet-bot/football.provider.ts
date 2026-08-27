import { fetchWithTimeout } from '@memecoinbot/data-providers';
import {
  isPopularTeam,
  isListedFootball,
  foldName,
  leagueCountry,
  leagueHeading,
  countryFlag,
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

const TSDB = 'https://www.thesportsdb.com/api/v1/json/3';
const FD = 'https://api.football-data.org/v4';
const FOTMOB = 'https://www.fotmob.com';
const FOTMOB_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};
const FOTMOB_LEAGUES = [
  47, 87, 55, 54, 53, 42, 73, 48, 57, 61, 67, 71, 130, 268, 112, 196, 113, 44, 46, 110, 65,
];

const TSDB_LEAGUES: Array<{ id: string; name: string }> = [
  { id: '4328', name: 'English Premier League' },
  { id: '4335', name: 'Spanish La Liga' },
  { id: '4332', name: 'Italian Serie A' },
  { id: '4331', name: 'German Bundesliga' },
  { id: '4334', name: 'French Ligue 1' },
  { id: '4480', name: 'UEFA Champions League' },
  { id: '4481', name: 'UEFA Europa League' },
  { id: '4482', name: 'UEFA Europa Conference League' },
  { id: '4329', name: 'FA Cup' },
  { id: '4374', name: 'EFL Cup' },
  { id: '4337', name: 'English Championship' },
  { id: '4330', name: 'Dutch Eredivisie' },
  { id: '4344', name: 'Portuguese Primeira Liga' },
  { id: '4338', name: 'Belgian Pro League' },
  { id: '4356', name: 'Turkish Super Lig' },
  { id: '4370', name: 'Scottish Premiership' },
  { id: '4346', name: 'Brazilian Serie A' },
  { id: '4351', name: 'Argentine Primera Division' },
  { id: '4358', name: 'American Major League Soccer' },
  { id: '4354', name: 'Mexican Liga MX' },
  { id: '4397', name: 'Saudi Professional League' },
  { id: '4401', name: 'Japanese J1 League' },
  { id: '4403', name: 'South Korean K League 1' },
  { id: '4408', name: 'Egyptian Premier League' },
  { id: '4414', name: 'South African Premier Soccer League' },
  { id: '4416', name: 'Moroccan Botola Pro' },
  { id: '4483', name: 'CAF Champions League' },
  { id: '4484', name: 'Copa Libertadores' },
];

type CacheEntry<T> = { at: number; data: T; ttl?: number };
const cache = new Map<string, CacheEntry<unknown>>();
const TTL = 8 * 60 * 1000;
const EMPTY_TTL = 45 * 1000;

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

function matchKey(home: string, away: string, kickoffUtc: string): string {
  return `${foldName(home)}|${foldName(away)}|${kickoffUtc.slice(0, 10)}`;
}

export function isLiveStatus(status: string | undefined): boolean {
  return /^(in.?play|live|1h|2h|ht|et|pen|paused|half)/i.test((status ?? '').trim());
}

export function dedupeEvents(events: RawEvent[]): RawEvent[] {
  const map = new Map<string, RawEvent>();
  for (const e of events) {
    const k = matchKey(e.homeName, e.awayName, e.kickoffUtc);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, e);
      continue;
    }
    const prefer =
      (e.live && !prev.live) ||
      (e.id.startsWith('fd_') && !prev.id.startsWith('fd_') && !prev.live) ||
      (e.homeScore != null && prev.homeScore == null);
    if (prefer) map.set(k, { ...prev, ...e, live: Boolean(e.live || prev.live) });
  }
  return [...map.values()].sort((a, b) => {
    if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
    return a.kickoffUtc.localeCompare(b.kickoffUtc);
  });
}

function upcoming(e: RawEvent): boolean {
  if (e.live || isLiveStatus(e.status)) return true;
  const t = Date.parse(e.kickoffUtc);
  if (!Number.isFinite(t)) return true;
  return t >= Date.now() - 150 * 60 * 1000;
}

export function footballDataConfigured(): boolean {
  return Boolean(process.env.FOOTBALL_DATA_TOKEN?.trim());
}

export function oddsApiConfigured(): boolean {
  return Boolean(process.env.ODDS_API_KEY?.trim());
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
    kickoffUtc: e.kickoffUtc,
    venue: e.venue,
    status: live ? 'LIVE' : e.status,
    home: { id: e.homeId, name: e.homeName, popular: homePop },
    away: { id: e.awayId, name: e.awayName, popular: awayPop },
    popularMatch: homePop || awayPop,
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
  const url = `${TSDB}/${path}`;
  const res = await fetchWithTimeout(url, {}, 12000);
  if (!res.ok) throw new Error(`TheSportsDB HTTP ${res.status}`);
  return res.json();
}

async function fetchTsdbByDay(): Promise<RawEvent[]> {
  const days = Array.from({ length: 10 }, (_, n) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  });
  return mapBatches(days, 2, async (day) => {
    const json = (await tsdbJson(`eventsday.php?d=${day}&s=Soccer`)) as {
      events?: Array<Record<string, string | null>>;
    };
    const rows: RawEvent[] = [];
    for (const ev of json.events ?? []) {
      const row = tsdbEvent(ev, ev.strLeague ?? '');
      if (row && isListedFootball(row.league)) rows.push(row);
    }
    return rows;
  });
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

const FD_COMPS = ['PL', 'PD', 'SA', 'BL1', 'FL1', 'CL', 'EL', 'ECL'];

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

const LIVE_TTL = 45 * 1000;
const ODDS_SCORE_SPORTS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
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

export async function listLiveRaw(): Promise<{ source: string; events: RawEvent[] }> {
  const [tsdb, fd, odds] = await Promise.allSettled([
    fetchTsdbLivescores(),
    fetchFdLive(),
    fetchOddsLiveScores(),
  ]);
  const parts = [
    tsdb.status === 'fulfilled' ? tsdb.value : [],
    fd.status === 'fulfilled' ? fd.value : [],
    odds.status === 'fulfilled' ? odds.value : [],
  ];
  const events = dedupeEvents(parts.flat()).filter((e) => e.live || isLiveStatus(e.status));
  const sources: string[] = [];
  if (tsdb.status === 'fulfilled' && tsdb.value.length) sources.push('thesportsdb-live');
  if (fd.status === 'fulfilled' && fd.value.length) sources.push('football-data-live');
  if (odds.status === 'fulfilled' && odds.value.length) sources.push('odds-api-scores');
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

function namesClose(a: string, b: string): boolean {
  const canon = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(fc|cf|afc|sc|ac|ssc|ud|cd)\b/g, '')
      .replace(/^man /, 'manchester ')
      .replace(/\s+/g, ' ')
      .trim();
  const x = canon(a);
  const y = canon(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const xt = x.split(' ')[0] ?? x;
  const yt = y.split(' ')[0] ?? y;
  return xt.length >= 5 && yt.length >= 5 && (x.includes(yt) || y.includes(xt));
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
  return all.find((e) => e.id === decoded) ?? null;
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
  const [fd, tsdb, live, openliga] = await Promise.allSettled([
    footballDataConfigured() ? fetchFdFixtures(from, to) : Promise.resolve([] as RawEvent[]),
    fetchTsdbFixtures(),
    listLiveRaw().then((r) => r.events),
    fetchOpenLigaFixtures(),
  ]);
  const fdEvents = fd.status === 'fulfilled' ? fd.value : [];
  const tsdbEvents = tsdb.status === 'fulfilled' ? tsdb.value : [];
  const liveEvents = live.status === 'fulfilled' ? live.value : [];
  const olEvents = openliga.status === 'fulfilled' ? openliga.value : [];
  const events = dedupeEvents([...fdEvents, ...tsdbEvents, ...olEvents, ...liveEvents]).filter(upcoming);
  const sources: string[] = [];
  if (fdEvents.length) sources.push('football-data.org');
  if (tsdbEvents.length) sources.push('thesportsdb');
  if (olEvents.length) sources.push('openligadb');
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
  const res = await fetchWithTimeout(`${FOTMOB}${path}`, { headers: FOTMOB_HEADERS }, 12000);
  if (!res.ok) throw new Error(`FotMob HTTP ${res.status}`);
  return res.json();
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
