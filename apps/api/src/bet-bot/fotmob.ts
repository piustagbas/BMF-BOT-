import { foldName } from './popular';
import type { TeamMatchRow } from './types';

export type FotmobFixture = {
  home?: { id?: number; name?: string; score?: number | null };
  away?: { id?: number; name?: string; score?: number | null };
  status?: { utcTime?: string; finished?: boolean };
  tournament?: { name?: string };
};

export type FotmobFormItem = {
  resultString?: string;
  tooltipText?: {
    homeTeam?: string;
    homeTeamId?: number;
    homeScore?: number;
    awayTeam?: string;
    awayTeamId?: number;
    awayScore?: number;
    utcTime?: string;
  };
  home?: { id?: number; name?: string };
  away?: { id?: number; name?: string };
  date?: { utcTime?: string };
};

export function teamsFromLeaguePayload(payload: unknown): Array<{ id: string; name: string; shortName?: string }> {
  const out: Array<{ id: string; name: string; shortName?: string }> = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const all = o.all;
    if (Array.isArray(all) && all.length && typeof (all[0] as { played?: unknown } | undefined)?.played === 'number') {
      for (const row of all) {
        if (!row || typeof row !== 'object') continue;
        const r = row as { id?: number | string; name?: string; shortName?: string };
        if (r.id == null || !r.name) continue;
        const id = String(r.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, name: r.name, shortName: r.shortName });
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(payload);
  return out;
}

export function lookupFotmobId(
  name: string,
  directory: Map<string, string>,
): string | null {
  const n = foldName(name);
  if (!n) return null;
  const direct = directory.get(n);
  if (direct) return direct;
  for (const [k, id] of directory) {
    if (n.includes(k) || k.includes(n)) {
      if (Math.min(n.length, k.length) >= 5) return id;
    }
  }
  const compact = n.replace(/\b(fc|cf|afc|sc|ac|ssc|ud|cd|the)\b/g, '').replace(/\s+/g, ' ').trim();
  if (compact && compact !== n) {
    const hit = directory.get(compact);
    if (hit) return hit;
  }
  if (n.startsWith('man ') && !n.startsWith('manchester ')) {
    const expanded = `manchester ${n.slice(4)}`;
    const hit = directory.get(expanded);
    if (hit) return hit;
  }
  return null;
}

export function indexFotmobDirectory(teams: Array<{ id: string; name: string; shortName?: string }>): Map<string, string> {
  const dir = new Map<string, string>();
  for (const t of teams) {
    dir.set(foldName(t.name), t.id);
    if (t.shortName) dir.set(foldName(t.shortName), t.id);
  }
  return dir;
}

function scoreOf(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function rowsFromFotmobFixtures(teamNumericId: string, fixtures: FotmobFixture[]): TeamMatchRow[] {
  const tid = String(teamNumericId);
  const dated: Array<TeamMatchRow & { at: string }> = [];
  for (const f of fixtures) {
    if (f.status?.finished === false) continue;
    const hs = scoreOf(f.home?.score);
    const as = scoreOf(f.away?.score);
    if (hs == null || as == null) continue;
    const isHome = String(f.home?.id) === tid;
    const isAway = String(f.away?.id) === tid;
    if (!isHome && !isAway) continue;
    dated.push({
      isHome,
      gf: isHome ? hs : as,
      ga: isHome ? as : hs,
      opponent: (isHome ? f.away?.name : f.home?.name) ?? 'unknown',
      playedAt: f.status?.utcTime,
      at: f.status?.utcTime ?? '',
    });
  }
  dated.sort((a, b) => b.at.localeCompare(a.at));
  return dated.map(({ at: _at, ...row }) => row);
}

export function rowsFromFotmobForm(teamNumericId: string, form: FotmobFormItem[]): TeamMatchRow[] {
  const tid = Number(teamNumericId);
  const rows: TeamMatchRow[] = [];
  for (const item of form) {
    const tip = item.tooltipText;
    if (!tip || tip.homeScore == null || tip.awayScore == null) continue;
    const isHome = tip.homeTeamId === tid || String(item.home?.id) === String(tid);
    rows.push({
      isHome,
      gf: isHome ? tip.homeScore : tip.awayScore,
      ga: isHome ? tip.awayScore : tip.homeScore,
      opponent: isHome ? tip.awayTeam ?? item.away?.name ?? 'unknown' : tip.homeTeam ?? item.home?.name ?? 'unknown',
      playedAt: tip.utcTime ?? item.date?.utcTime,
    });
  }
  return rows;
}

/** Newest first, unique opponent+score+date, max 10. */
export function mergeFotmobRows(primary: TeamMatchRow[], extra: TeamMatchRow[]): TeamMatchRow[] {
  const seen = new Set<string>();
  const out: TeamMatchRow[] = [];
  for (const r of [...primary, ...extra]) {
    const k = `${r.playedAt ?? ''}|${r.opponent}|${r.gf}-${r.ga}|${r.isHome ? 'H' : 'A'}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= 10) break;
  }
  return out;
}
