import type { BetMarket, SplitStats, TeamMatchRow, TeamSnapshot } from './types';

export function emptySplit(): SplitStats {
  return {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    cleanSheets: 0,
    failedToScore: 0,
    over05: 0,
    over15: 0,
    over25: 0,
    over35: 0,
    over45: 0,
    btts: 0,
  };
}

export function splitFromRows(rows: TeamMatchRow[]): SplitStats {
  const s = emptySplit();
  for (const r of rows) {
    s.played += 1;
    const total = r.gf + r.ga;
    if (r.gf > r.ga) s.wins += 1;
    else if (r.gf === r.ga) s.draws += 1;
    else s.losses += 1;
    s.gf += r.gf;
    s.ga += r.ga;
    if (r.ga === 0) s.cleanSheets += 1;
    if (r.gf === 0) s.failedToScore += 1;
    if (total > 0) s.over05 += 1;
    if (total > 1) s.over15 += 1;
    if (total > 2) s.over25 += 1;
    if (total > 3) s.over35 += 1;
    if (total > 4) s.over45 += 1;
    if (r.gf > 0 && r.ga > 0) s.btts += 1;
  }
  return s;
}

export function formString(rows: TeamMatchRow[], n: number): string {
  return rows
    .slice(0, n)
    .map((r) => (r.gf > r.ga ? 'W' : r.gf === r.ga ? 'D' : 'L'))
    .join('');
}

export function pct(hits: number, played: number): number | null {
  if (played < 3) return null;
  return Math.round((hits / played) * 1000) / 10;
}

export type Last5Profile = {
  n: number;
  known: boolean;
  gf: number;
  ga: number;
  total: number;
  scored2: number;
  scored: number;
  over15: number;
  over25: number;
  over35: number;
  btts: number;
  wins: number;
  draws: number;
  failedToScore: number;
  lastOver25: boolean;
  lastWin: boolean;
  lastBtts: boolean;
  lastGf: number;
  lastTotal: number;
  over25Rate: number;
  winRate: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function emptyProfile(): Last5Profile {
  return {
    n: 0,
    known: false,
    gf: 0,
    ga: 0,
    total: 0,
    scored2: 0,
    scored: 0,
    over15: 0,
    over25: 0,
    over35: 0,
    btts: 0,
    wins: 0,
    draws: 0,
    failedToScore: 0,
    lastOver25: false,
    lastWin: false,
    lastBtts: false,
    lastGf: 0,
    lastTotal: 0,
    over25Rate: 0,
    winRate: 0,
  };
}

function fromRows(rows: TeamMatchRow[]): Last5Profile {
  const n = rows.length;
  const last = rows[0]!;
  const lastTotal = last.gf + last.ga;
  const over25 = rows.filter((r) => r.gf + r.ga > 2).length;
  const wins = rows.filter((r) => r.gf > r.ga).length;
  return {
    n,
    known: true,
    gf: round1(rows.reduce((s, r) => s + r.gf, 0) / n),
    ga: round1(rows.reduce((s, r) => s + r.ga, 0) / n),
    total: round1(rows.reduce((s, r) => s + r.gf + r.ga, 0) / n),
    scored2: rows.filter((r) => r.gf >= 2).length,
    scored: rows.filter((r) => r.gf > 0).length,
    over15: rows.filter((r) => r.gf + r.ga > 1).length,
    over25,
    over35: rows.filter((r) => r.gf + r.ga > 3).length,
    btts: rows.filter((r) => r.gf > 0 && r.ga > 0).length,
    wins,
    draws: rows.filter((r) => r.gf === r.ga).length,
    failedToScore: rows.filter((r) => r.gf === 0).length,
    lastOver25: lastTotal > 2,
    lastWin: last.gf > last.ga,
    lastBtts: last.gf > 0 && last.ga > 0,
    lastGf: last.gf,
    lastTotal,
    over25Rate: over25 / n,
    winRate: wins / n,
  };
}

/** Last 1–5 matches: uses the actual games, including a single last result. */
export function last5Profile(t: TeamSnapshot): Last5Profile {
  const rows = (t.recent ?? []).slice(0, 5);
  if (rows.length >= 1) return fromRows(rows);

  const played = t.sampleSize ?? t.wins + t.draws + t.losses;
  if (played < 1 || (t.goalsFor === 0 && t.goalsAgainst === 0 && !t.last5)) {
    return emptyProfile();
  }
  const n = Math.min(Math.max(played, 1), 5);
  const gf = round1(t.goalsFor / Math.max(played, 1));
  const ga = round1(t.goalsAgainst / Math.max(played, 1));
  const total = round1(gf + ga);
  const form = (t.last5 || '').toUpperCase().replace(/[^WDL]/g, '').slice(0, 5);
  const wins = (form.match(/W/g) ?? []).length;
  const over25 = total >= 2.6 ? Math.min(n, 4) : total >= 2.2 ? Math.min(n, 2) : 0;
  return {
    n,
    known: true,
    gf,
    ga,
    total,
    scored2: gf >= 2 ? Math.min(n, 3) : gf >= 1.5 ? Math.min(n, 2) : 0,
    scored: gf >= 1 ? Math.min(n, 4) : gf >= 0.6 ? Math.min(n, 3) : Math.min(n, 1),
    over15: total >= 1.6 ? Math.min(n, 4) : Math.min(n, 2),
    over25,
    over35: total >= 3.4 ? Math.min(n, 3) : 0,
    btts: gf >= 1 && ga >= 1 ? Math.min(n, 3) : Math.min(n, 1),
    wins,
    draws: (form.match(/D/g) ?? []).length,
    failedToScore: gf < 0.6 ? Math.min(n, 3) : 0,
    lastOver25: total > 2.5,
    lastWin: form.startsWith('W'),
    lastBtts: gf >= 1 && ga >= 1,
    lastGf: gf,
    lastTotal: total,
    over25Rate: over25 / n,
    winRate: wins / Math.max(n, 1),
  };
}

export type FormSignals = {
  h: Last5Profile;
  a: Last5Profile;
  known: boolean;
  avgTot: number;
  overRate: number;
  lastOver: boolean;
  lastBothOver: boolean;
  eitherOverHeavy: boolean;
  bothUnderHeavy: boolean;
  homeStrong: boolean;
  awayStrong: boolean;
  homeUnbeaten: boolean;
  awayUnbeaten: boolean;
  bothAttack: boolean;
  bothTight: boolean;
  bothScore: boolean;
  evenMatch: boolean;
  estCorners: number;
  estCards: number;
};

/** Combined read of both last-5 cards — missing data is not treated as 0-0. */
export function formSignals(home: TeamSnapshot, away: TeamSnapshot): FormSignals {
  const h = last5Profile(home);
  const a = last5Profile(away);
  const known = h.known && a.known;
  const avgTot = h.known && a.known ? (h.total + a.total) / 2 : h.known ? h.total : a.known ? a.total : 2.5;
  const overN = (h.known ? h.n : 0) + (a.known ? a.n : 0);
  const overHits = (h.known ? h.over25 : 0) + (a.known ? a.over25 : 0);
  const overRate = overN > 0 ? overHits / overN : 0;
  const lastOver = (h.known && h.lastOver25) || (a.known && a.lastOver25);
  const lastBothOver = h.known && a.known && h.lastOver25 && a.lastOver25;
  const eitherOverHeavy = (h.known && h.over25Rate >= 0.6) || (a.known && a.over25Rate >= 0.6);
  const bothUnderHeavy =
    h.known && a.known && h.n >= 1 && a.n >= 1 && h.over25Rate <= 0.4 && a.over25Rate <= 0.4 && avgTot <= 2.3;
  const homeStrong = h.known && (h.wins >= 4 || (h.winRate >= 0.6 && h.gf - a.gf >= 0.7));
  const awayStrong = a.known && (a.wins >= 4 || (a.winRate >= 0.6 && a.gf - h.gf >= 0.7));
  const homeUnbeaten = h.known && h.n >= 3 && h.wins + h.draws >= h.n - 1;
  const awayUnbeaten = a.known && a.n >= 3 && a.wins + a.draws >= a.n - 1;
  const bothAttack = h.known && a.known && h.gf >= 1.6 && a.gf >= 1.6;
  const bothTight = known && avgTot <= 2.15 && h.over25Rate <= 0.4 && a.over25Rate <= 0.4;
  const bothScore = h.known && a.known && h.scored >= Math.max(2, h.n - 1) && a.scored >= Math.max(2, a.n - 1);
  const evenMatch = known && Math.abs(h.winRate - a.winRate) <= 0.25 && Math.abs(h.gf - a.gf) < 0.5;
  const estCorners = Math.max(6.5, Math.min(14, round1(9.1 + (avgTot - 2.5) * 1.35 + (bothAttack ? 0.6 : 0))));
  const estCards = Math.max(2.2, Math.min(6.2, round1(3.3 + (evenMatch ? 0.9 : -0.25) + (bothTight ? 0.35 : 0))));
  return {
    h,
    a,
    known,
    avgTot,
    overRate,
    lastOver,
    lastBothOver,
    eitherOverHeavy,
    bothUnderHeavy,
    homeStrong,
    awayStrong,
    homeUnbeaten,
    awayUnbeaten,
    bothAttack,
    bothTight,
    bothScore,
    evenMatch,
    estCorners,
    estCards,
  };
}

/** Combined recent-match delivery for a market. Null when sample is too small — not invented. */
export function sampleDelivery(
  market: BetMarket,
  home: TeamSnapshot,
  away: TeamSnapshot,
): { rate: number | null; sample: number; note: string } {
  const h = home.recent ?? [];
  const a = away.recent ?? [];
  const sample = h.length + a.length;
  if (sample < 6) {
    return { rate: null, sample, note: 'UNKNOWN — fewer than 6 recent results; delivery rate not invented.' };
  }
  let hits = 0;
  const count = (rows: TeamMatchRow[], pred: (r: TeamMatchRow) => boolean) => {
    for (const r of rows) if (pred(r)) hits += 1;
  };
  switch (market) {
    case 'OVER_0_5':
      count(h, (r) => r.gf + r.ga > 0);
      count(a, (r) => r.gf + r.ga > 0);
      break;
    case 'OVER_1_5':
      count(h, (r) => r.gf + r.ga > 1);
      count(a, (r) => r.gf + r.ga > 1);
      break;
    case 'OVER_2_5':
      count(h, (r) => r.gf + r.ga > 2);
      count(a, (r) => r.gf + r.ga > 2);
      break;
    case 'OVER_3_5':
      count(h, (r) => r.gf + r.ga > 3);
      count(a, (r) => r.gf + r.ga > 3);
      break;
    case 'OVER_4_5':
      count(h, (r) => r.gf + r.ga > 4);
      count(a, (r) => r.gf + r.ga > 4);
      break;
    case 'UNDER_1_5':
      count(h, (r) => r.gf + r.ga <= 1);
      count(a, (r) => r.gf + r.ga <= 1);
      break;
    case 'UNDER_2_5':
      count(h, (r) => r.gf + r.ga <= 2);
      count(a, (r) => r.gf + r.ga <= 2);
      break;
    case 'UNDER_3_5':
      count(h, (r) => r.gf + r.ga <= 3);
      count(a, (r) => r.gf + r.ga <= 3);
      break;
    case 'UNDER_4_5':
      count(h, (r) => r.gf + r.ga <= 4);
      count(a, (r) => r.gf + r.ga <= 4);
      break;
    case 'BTTS_YES':
      count(h, (r) => r.gf > 0 && r.ga > 0);
      count(a, (r) => r.gf > 0 && r.ga > 0);
      break;
    case 'BTTS_NO':
      count(h, (r) => !(r.gf > 0 && r.ga > 0));
      count(a, (r) => !(r.gf > 0 && r.ga > 0));
      break;
    case 'UNDER_0_5':
      count(h, (r) => r.gf + r.ga === 0);
      count(a, (r) => r.gf + r.ga === 0);
      break;
    case 'HOME_TO_SCORE':
    case 'HOME_OVER_0_5':
      count(h, (r) => r.isHome && r.gf > 0);
      return {
        rate: pct(hits, h.filter((r) => r.isHome).length),
        sample: h.filter((r) => r.isHome).length,
        note: 'Home team recent home matches only.',
      };
    case 'HOME_OVER_1_5':
      count(h, (r) => r.isHome && r.gf > 1);
      return {
        rate: pct(hits, h.filter((r) => r.isHome).length),
        sample: h.filter((r) => r.isHome).length,
        note: 'Home team recent home matches, 2+ goals.',
      };
    case 'AWAY_TO_SCORE':
    case 'AWAY_OVER_0_5':
      count(a, (r) => !r.isHome && r.gf > 0);
      return {
        rate: pct(hits, a.filter((r) => !r.isHome).length),
        sample: a.filter((r) => !r.isHome).length,
        note: 'Away team recent away matches only.',
      };
    case 'AWAY_OVER_1_5':
      count(a, (r) => !r.isHome && r.gf > 1);
      return {
        rate: pct(hits, a.filter((r) => !r.isHome).length),
        sample: a.filter((r) => !r.isHome).length,
        note: 'Away team recent away matches, 2+ goals.',
      };
    case 'HOME':
    case 'AH_HOME_0':
    case 'AH_HOME_M05': {
      const rows = h.slice(0, 5);
      const wins = rows.filter((r) => r.gf > r.ga).length;
      return {
        rate: pct(wins, rows.length),
        sample: rows.length,
        note: `${home.name} won ${wins}/${rows.length} of last ${rows.length}.`,
      };
    }
    case 'AWAY':
    case 'AH_AWAY_0': {
      const rows = a.slice(0, 5);
      const wins = rows.filter((r) => r.gf > r.ga).length;
      return {
        rate: pct(wins, rows.length),
        sample: rows.length,
        note: `${away.name} won ${wins}/${rows.length} of last ${rows.length}.`,
      };
    }
    case 'DC_1X':
    case 'AH_HOME_P05':
    case 'DNB_HOME': {
      const rows = h.slice(0, 5);
      const hits = rows.filter((r) => r.gf >= r.ga).length;
      return {
        rate: pct(hits, rows.length),
        sample: rows.length,
        note: `${home.name} unbeaten in ${hits}/${rows.length} last results.`,
      };
    }
    case 'DC_X2':
    case 'DNB_AWAY': {
      const rows = a.slice(0, 5);
      const hits = rows.filter((r) => r.gf >= r.ga).length;
      return {
        rate: pct(hits, rows.length),
        sample: rows.length,
        note: `${away.name} unbeaten in ${hits}/${rows.length} last results.`,
      };
    }
    case 'OVER_10_5_CORNERS':
    case 'UNDER_10_5_CORNERS': {
      const sig = formSignals(home, away);
      const over = sig.estCorners > 10.5;
      const rate =
        market === 'OVER_10_5_CORNERS'
          ? Math.round(Math.max(28, Math.min(78, 50 + (sig.estCorners - 10.5) * 12)) * 10) / 10
          : Math.round(Math.max(28, Math.min(78, 50 + (10.5 - sig.estCorners) * 12)) * 10) / 10;
      return {
        rate: sig.known ? rate : null,
        sample: (home.recent?.length ?? 0) + (away.recent?.length ?? 0),
        note: sig.known
          ? `No official corner feed. Tempo from last matches (~${sig.estCorners} corners) ${over ? 'leans over' : 'leans under'} 10.5.`
          : 'UNKNOWN — no official corner stats in the feed.',
      };
    }
    case 'OVER_3_5_CARDS':
    case 'UNDER_3_5_CARDS': {
      const sig = formSignals(home, away);
      const rate =
        market === 'OVER_3_5_CARDS'
          ? Math.round(Math.max(28, Math.min(76, 48 + (sig.estCards - 3.5) * 14)) * 10) / 10
          : Math.round(Math.max(28, Math.min(76, 48 + (3.5 - sig.estCards) * 14)) * 10) / 10;
      return {
        rate: sig.known ? rate : null,
        sample: (home.recent?.length ?? 0) + (away.recent?.length ?? 0),
        note: sig.known
          ? `No official card feed. Evenness/tempo estimate ~${sig.estCards} yellows.`
          : 'UNKNOWN — no official yellow-card stats in the feed.',
      };
    }
    case 'HOME_PLAYER_SCORE': {
      const scorer = home.topScorer;
      if (!scorer) {
        return { rate: null, sample: h.length, note: 'UNKNOWN — no named home scorer in recent results.' };
      }
      return {
        rate: pct(Math.min(scorer.last5Goals, 5), Math.min(h.length || 5, 5)),
        sample: Math.min(h.length || 5, 5),
        note: `${scorer.name} scored ${scorer.last5Goals} in the last-5 sample (${scorer.goals} total in feed).`,
      };
    }
    case 'AWAY_PLAYER_SCORE': {
      const scorer = away.topScorer;
      if (!scorer) {
        return { rate: null, sample: a.length, note: 'UNKNOWN — no named away scorer in recent results.' };
      }
      return {
        rate: pct(Math.min(scorer.last5Goals, 5), Math.min(a.length || 5, 5)),
        sample: Math.min(a.length || 5, 5),
        note: `${scorer.name} scored ${scorer.last5Goals} in the last-5 sample (${scorer.goals} total in feed).`,
      };
    }
    default:
      return {
        rate: null,
        sample,
        note: 'UNKNOWN — no historical sample for this market in the feed (not invented).',
      };
  }
  return {
    rate: pct(hits, sample),
    sample,
    note: `Combined last ${h.length}+${a.length} results for both clubs. Not the same as this fixture repeating.`,
  };
}

export function h2hNote(home: TeamSnapshot, away: TeamSnapshot): string {
  const rows = (home.recent ?? []).filter((r) =>
    r.opponent.toLowerCase().includes(away.name.toLowerCase().split(' ')[0] ?? away.name.toLowerCase()),
  );
  if (rows.length < 2) {
    return 'UNKNOWN — fewer than 2 recent H2H meetings in the sample. Old H2H is not invented.';
  }
  const over15 = rows.filter((r) => r.gf + r.ga > 1).length;
  const btts = rows.filter((r) => r.gf > 0 && r.ga > 0).length;
  return `${rows.length} recent H2H in sample: Over 1.5 ${over15}/${rows.length}, BTTS ${btts}/${rows.length}. Not overweighted if squads changed.`;
}

function topScorerFrom(rows: TeamMatchRow[]): TeamSnapshot['topScorer'] {
  const counts = new Map<string, { total: number; last5: number }>();
  rows.forEach((r, i) => {
    for (const raw of r.scorers ?? []) {
      const name = raw.replace(/^\d+['’:]?\s*/, '').trim();
      if (name.length < 2) continue;
      const cur = counts.get(name) ?? { total: 0, last5: 0 };
      cur.total += 1;
      if (i < 5) cur.last5 += 1;
      counts.set(name, cur);
    }
  });
  let best: { name: string; goals: number; last5Goals: number } | undefined;
  for (const [name, c] of counts) {
    if (!best || c.last5 > best.last5Goals || (c.last5 === best.last5Goals && c.total > best.goals)) {
      best = { name, goals: c.total, last5Goals: c.last5 };
    }
  }
  return best;
}

export function snapshotFromRows(teamId: string, name: string, popular: boolean, rows: TeamMatchRow[]): TeamSnapshot {
  const recent = rows.slice(0, 10);
  const overall = splitFromRows(recent);
  const homeSplit = splitFromRows(recent.filter((r) => r.isHome));
  const awaySplit = splitFromRows(recent.filter((r) => !r.isHome));
  return {
    id: teamId,
    name,
    popular,
    last5: formString(recent, 5),
    last10: formString(recent, 10),
    wins: overall.wins,
    draws: overall.draws,
    losses: overall.losses,
    goalsFor: overall.gf,
    goalsAgainst: overall.ga,
    homeWins: homeSplit.wins,
    awayWins: awaySplit.wins,
    recent,
    overall,
    homeSplit,
    awaySplit,
    sampleSize: recent.length,
    dataReliability: recent.length >= 8 ? 'GOOD' : recent.length >= 4 ? 'LIMITED' : 'UNKNOWN',
    topScorer: topScorerFrom(recent),
  };
}
