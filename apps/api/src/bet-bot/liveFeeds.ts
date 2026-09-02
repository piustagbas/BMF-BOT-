import { fetchWithTimeout } from '@memecoinbot/data-providers';

export type LiveFeedEvent = {
  id: string;
  league: string;
  kickoffUtc: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  status: string;
  live: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
  minute?: string;
  country?: string;
};

/** Drop HTML/ad pages so live scores never come from a scraped ad-filled site. */
export function looksLikeHtmlOrAds(body: string, contentType?: string | null): boolean {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('text/html')) return true;
  const t = body.trim();
  if (!t) return false;
  const head = t.slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) return true;
  if (t.startsWith('<') && !t.startsWith('{') && !t.startsWith('[')) return true;
  return /adsbygoogle|doubleclick\.net|googlesyndication|taboola\.com|outbrain\.com/i.test(t.slice(0, 4000));
}

export async function fetchJsonNoAds(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<unknown> {
  const res = await fetchWithTimeout(
    url,
    {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (looksLikeHtmlOrAds(text, res.headers.get('content-type'))) {
    throw new Error('blocked html/ads');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('blocked non-json');
  }
}

function nScore(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asIso(stamp: unknown): string {
  if (typeof stamp === 'number' && Number.isFinite(stamp)) {
    const ms = stamp < 1e12 ? stamp * 1000 : stamp;
    return new Date(ms).toISOString();
  }
  if (typeof stamp === 'string' && stamp.trim()) {
    const t = Date.parse(stamp);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

function liveMinute(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/'+/g, '').trim();
  return s || undefined;
}

export function eventsFromFotmobMatches(
  payload: unknown,
  opts?: { includeScheduled?: boolean; includeFinished?: boolean },
): LiveFeedEvent[] {
  const out: LiveFeedEvent[] = [];
  const walk = (node: unknown, league = '', country = '') => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, league, country);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const nextLeague =
      (typeof o.name === 'string' && (Array.isArray(o.matches) || Array.isArray(o.events)) ? o.name : null) ||
      (typeof o.localizedName === 'string' ? o.localizedName : null) ||
      league;
    const nextCountry =
      (typeof o.ccode === 'string' ? o.ccode : null) ||
      (typeof o.country === 'string' ? o.country : null) ||
      country;
    const home = o.home as { id?: number | string; name?: string; score?: number | null } | undefined;
    const away = o.away as { id?: number | string; name?: string; score?: number | null } | undefined;
    const status = o.status as
      | {
          utcTime?: string;
          started?: boolean;
          finished?: boolean;
          cancelled?: boolean;
          reason?: { short?: string; long?: string };
          liveTime?: { short?: string; long?: string };
        }
      | undefined;
    const finished = Boolean(status?.finished);
    const cancelled = Boolean(status?.cancelled);
    const started = Boolean(status?.started);
    const inPlay = Boolean(status && started && !finished && !cancelled);
    const scheduled = Boolean(status && !started && !finished && !cancelled);
    if (
      home?.name &&
      away?.name &&
      status &&
      (inPlay || (opts?.includeScheduled && scheduled) || (opts?.includeFinished && finished))
    ) {
      const id = o.id != null ? String(o.id) : `${home.name}_${away.name}`;
      out.push({
        id: `fotmob_${id}`,
        league: nextLeague || 'Football',
        kickoffUtc: asIso(status.utcTime),
        homeId: String(home.id ?? home.name),
        homeName: home.name,
        awayId: String(away.id ?? away.name),
        awayName: away.name,
        status: inPlay
          ? status.reason?.short || status.liveTime?.short || 'LIVE'
          : finished
            ? status.reason?.short || 'FT'
            : 'TIMED',
        live: inPlay,
        homeScore: nScore(home.score),
        awayScore: nScore(away.score),
        minute: inPlay ? liveMinute(status.liveTime?.short || status.reason?.short) : undefined,
        country: nextCountry || undefined,
      });
    }
    for (const v of Object.values(o)) walk(v, nextLeague, nextCountry);
  };
  walk(payload);
  return out;
}

export function eventsFromSofascoreScheduled(payload: unknown): LiveFeedEvent[] {
  const root = payload as { events?: Array<Record<string, unknown>> };
  const out: LiveFeedEvent[] = [];
  for (const ev of root.events ?? []) {
    const status = ev.status as { type?: string; description?: string } | undefined;
    const type = (status?.type ?? '').toLowerCase();
    if (type && type !== 'notstarted' && type !== 'scheduled') continue;
    const home = ev.homeTeam as { id?: number; name?: string } | undefined;
    const away = ev.awayTeam as { id?: number; name?: string } | undefined;
    if (!home?.name || !away?.name) continue;
    const tournament = ev.tournament as { name?: string; category?: { name?: string } } | undefined;
    out.push({
      id: `sofa_${ev.id ?? `${home.name}_${away.name}`}`,
      league: tournament?.name || 'Football',
      kickoffUtc: asIso(ev.startTimestamp),
      homeId: String(home.id ?? home.name),
      homeName: home.name,
      awayId: String(away.id ?? away.name),
      awayName: away.name,
      status: 'TIMED',
      live: false,
      country: tournament?.category?.name,
    });
  }
  return out;
}

export function eventsFromSofascoreLive(payload: unknown): LiveFeedEvent[] {
  const root = payload as { events?: Array<Record<string, unknown>> };
  const out: LiveFeedEvent[] = [];
  for (const ev of root.events ?? []) {
    const status = ev.status as { type?: string; description?: string } | undefined;
    if (!status || (status.type ?? '').toLowerCase() !== 'inprogress') continue;
    const home = ev.homeTeam as { id?: number; name?: string } | undefined;
    const away = ev.awayTeam as { id?: number; name?: string } | undefined;
    if (!home?.name || !away?.name) continue;
    const tournament = ev.tournament as { name?: string; category?: { name?: string } } | undefined;
    const homeScore = ev.homeScore as { current?: number; display?: number } | undefined;
    const awayScore = ev.awayScore as { current?: number; display?: number } | undefined;
    const clock = ev.time as { played?: unknown; prefix?: unknown } | undefined;
    out.push({
      id: `sofa_${ev.id ?? `${home.name}_${away.name}`}`,
      league: tournament?.name || 'Football',
      kickoffUtc: asIso(ev.startTimestamp),
      homeId: String(home.id ?? home.name),
      homeName: home.name,
      awayId: String(away.id ?? away.name),
      awayName: away.name,
      status: status.description || 'LIVE',
      live: true,
      homeScore: nScore(homeScore?.current ?? homeScore?.display),
      awayScore: nScore(awayScore?.current ?? awayScore?.display),
      minute: liveMinute(clock?.played ?? clock?.prefix ?? status.description),
      country: tournament?.category?.name,
    });
  }
  return out;
}

export function eventsFromLivescoreApp(payload: unknown): LiveFeedEvent[] {
  const root = payload as { Stages?: Array<Record<string, unknown>> };
  const out: LiveFeedEvent[] = [];
  for (const stage of root.Stages ?? []) {
    const league = String(stage.Snm || stage.CompN || 'Football');
    const country = typeof stage.Cnm === 'string' ? stage.Cnm : undefined;
    const events = (stage.Events as Array<Record<string, unknown>> | undefined) ?? [];
    for (const ev of events) {
      const t1 = ev.T1 as Array<{ Nm?: string; ID?: number | string }> | undefined;
      const t2 = ev.T2 as Array<{ Nm?: string; ID?: number | string }> | undefined;
      const homeName = t1?.[0]?.Nm;
      const awayName = t2?.[0]?.Nm;
      if (!homeName || !awayName) continue;
      const eps = String(ev.Eps ?? ev.Epr ?? '');
      if (/ft|aet|pen|ns|postp|canc/i.test(eps) && !/^\d/.test(eps)) continue;
      out.push({
        id: `ls_${ev.Eid ?? `${homeName}_${awayName}`}`,
        league,
        kickoffUtc: livescoreKickoff(ev.Esd),
        homeId: String(t1?.[0]?.ID ?? homeName),
        homeName,
        awayId: String(t2?.[0]?.ID ?? awayName),
        awayName,
        status: eps || 'LIVE',
        live: true,
        homeScore: nScore(ev.Tr1),
        awayScore: nScore(ev.Tr2),
        minute: liveMinute(eps),
        country,
      });
    }
  }
  return out;
}

function livescoreKickoff(esd: unknown): string {
  const s = String(esd ?? '');
  if (/^\d{14}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    const hh = s.slice(8, 10);
    const mm = s.slice(10, 12);
    const ss = s.slice(12, 14);
    return asIso(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
  }
  return asIso(esd);
}
