import { MARKET_LABELS } from './popular';
import { formSignals, h2hNote, sampleDelivery } from './matchStats';
import type {
  BetMarket,
  BookOdds,
  FixtureAnalysis,
  FixtureSummary,
  LineupInfo,
  MarketAnalysis,
  MarketOdds,
  MultiScorePick,
  PickCategory,
  RiskLevel,
  ScoreBreakdown,
  TeamSnapshot,
  TeamFormCard,
} from './types';
import { BET_DISCLAIMER } from './types';

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n * 10) / 10));
}

function poissonP(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function poissonOver(lambda: number, line: number): number {
  const minK = Math.floor(line) + 1;
  let s = 0;
  for (let k = minK; k <= minK + 24; k++) s += poissonP(k, lambda);
  return Math.max(0.05, Math.min(0.95, s));
}

function scoreMatrix(lh: number, la: number): number[][] {
  const max = 8;
  const m: number[][] = [];
  for (let h = 0; h <= max; h++) {
    m[h] = [];
    for (let a = 0; a <= max; a++) {
      m[h]![a] = poissonP(h, lh) * poissonP(a, la);
    }
  }
  return m;
}

function sumWhere(m: number[][], pred: (h: number, a: number) => boolean): number {
  let s = 0;
  for (let h = 0; h < m.length; h++) {
    for (let a = 0; a < m[h]!.length; a++) {
      if (pred(h, a)) s += m[h]![a]!;
    }
  }
  return s;
}

export const HOME_MULTISCORE_LINES = [
  [2, 0],
  [2, 1],
  [3, 0],
  [3, 1],
] as const;

export const AWAY_MULTISCORE_LINES = [
  [0, 2],
  [1, 2],
  [0, 3],
  [1, 3],
] as const;

export function buildMultiScorePick(
  grid: number[][],
  homeName: string,
  awayName: string,
  homeStrong: boolean,
  awayStrong: boolean,
): MultiScorePick {
  const pack = (side: 'HOME' | 'AWAY', lines: readonly (readonly [number, number])[]) => {
    const scores = lines.map(([h, a]) => ({
      line: `${h}-${a}`,
      home: h,
      away: a,
      probability: Math.round((grid[h]?.[a] ?? 0) * 1000) / 10,
    }));
    const combined = lines.reduce((s, [h, a]) => s + (grid[h]?.[a] ?? 0), 0);
    return { side, scores, combined };
  };
  const homePack = pack('HOME', HOME_MULTISCORE_LINES);
  const awayPack = pack('AWAY', AWAY_MULTISCORE_LINES);
  let chosen = homePack;
  if (awayStrong && !homeStrong) chosen = awayPack;
  else if (homeStrong && !awayStrong) chosen = homePack;
  else chosen = homePack.combined >= awayPack.combined ? homePack : awayPack;
  const p = chosen.combined;
  const lines = chosen.scores.map((s) => s.line).join(', ');
  return {
    side: chosen.side,
    label: chosen.side === 'HOME' ? `Home multiscore ${lines}` : `Away multiscore ${lines}`,
    scores: chosen.scores,
    combinedProbability: Math.round(p * 1000) / 10,
    analysedOdds: p >= 0.08 && p <= 0.97 ? Math.round((1 / p) * 100) / 100 : null,
    reason:
      chosen.side === 'HOME'
        ? `${homeName} win scores: 2-0, 2-1, 3-0, 3-1. Combined model ${Math.round(p * 100)}%. Confirm the multi-score box on the site.`
        : `${awayName} win scores: 0-2, 1-2, 0-3, 1-3. Combined model ${Math.round(p * 100)}%. Confirm the multi-score box on the site.`,
  };
}

export function formScore(last5: string): number {
  const chars = last5.replace(/[^WDL]/gi, '').slice(0, 5).toUpperCase().split('');
  if (!chars.length) return 50;
  const pts = chars.reduce((acc, c) => acc + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0);
  return clamp((pts / (chars.length * 3)) * 100);
}

export function impliedProb(decimalOdds: number | null): number | null {
  if (decimalOdds == null || decimalOdds <= 1) return null;
  return 1 / decimalOdds;
}

function playCategory(params: {
  safety: number;
  edgePct: number | null;
  odds: number | null;
}): { category: PickCategory; riskLevel: RiskLevel } {
  const odds = params.odds ?? 0;
  const edge = params.edgePct ?? -100;
  if (params.safety >= 80 && (odds <= 0 || odds <= 2.2)) {
    return { category: 'SAFEST', riskLevel: params.safety >= 90 ? 'High Confidence' : 'Low Risk' };
  }
  if (edge >= 5) {
    return { category: 'BEST_VALUE', riskLevel: 'Value' };
  }
  if (odds >= 2.2) {
    return { category: 'HIGH_ODDS', riskLevel: params.safety >= 70 ? 'Qualified' : 'Value' };
  }
  if (params.safety >= 70) {
    return { category: 'SAFEST', riskLevel: 'Qualified' };
  }
  return { category: 'SAFEST', riskLevel: 'Qualified' };
}

export function categorize(params: {
  safety: number;
  edgePct: number | null;
  odds: number | null;
  avoid: boolean;
}): { category: PickCategory; riskLevel: RiskLevel } {
  if (params.avoid || params.safety < 70) {
    return { category: 'AVOID', riskLevel: 'Avoid' };
  }
  return playCategory(params);
}

const LAZY_DEFAULTS = new Set<BetMarket>([
  'OVER_0_5',
  'UNDER_0_5',
  'UNDER_3_5',
  'UNDER_4_5',
  'OVER_4_5',
  'DC_12',
  'UNDER_1_5',
]);

export const PLAYABLE_MARKETS = new Set<BetMarket>([
  'HOME',
  'AWAY',
  'DRAW',
  'DC_1X',
  'DC_X2',
  'DNB_HOME',
  'DNB_AWAY',
  'OVER_1_5',
  'OVER_2_5',
  'OVER_3_5',
  'UNDER_2_5',
  'BTTS_YES',
  'BTTS_NO',
  'HOME_OVER_1_5',
  'AWAY_OVER_1_5',
  'HOME_TO_SCORE',
  'AWAY_TO_SCORE',
  'OVER_10_5_CORNERS',
  'UNDER_10_5_CORNERS',
  'OVER_3_5_CARDS',
  'UNDER_3_5_CARDS',
  'HOME_PLAYER_SCORE',
  'AWAY_PLAYER_SCORE',
]);

/** How well this market matches what both teams just did — last match counts. */
export function styleFit(market: BetMarket, home: TeamSnapshot, away: TeamSnapshot): number {
  const s = formSignals(home, away);
  const { h, a } = s;

  switch (market) {
    case 'OVER_2_5': {
      if (s.bothUnderHeavy) return -40;
      if (!s.known) return -14;
      const bothOverLean = s.bothAttack && s.overRate >= 0.55 && s.avgTot >= 2.65;
      if (!bothOverLean) return s.overRate >= 0.5 && s.lastBothOver ? 6 : -18;
      return (
        (s.lastBothOver ? 20 : s.lastOver ? 4 : 0) +
        (s.overRate >= 0.7 ? 22 : 10) +
        (s.avgTot >= 3 ? 12 : 6)
      );
    }
    case 'OVER_1_5':
      if (s.avgTot >= 2.8) return -10;
      return (h.over15 + a.over15 >= Math.max(4, (h.n + a.n) - 2) ? 16 : 4) + (s.avgTot >= 2.05 && s.avgTot < 2.65 ? 12 : 0);
    case 'OVER_3_5':
      return s.avgTot >= 3.3 && s.overRate >= 0.7 ? 30 : h.over35 + a.over35 >= 5 ? 16 : -22;
    case 'UNDER_2_5':
      if (s.lastOver || s.eitherOverHeavy) return -40;
      if (!s.known) return -18;
      return s.bothUnderHeavy ? 38 : s.bothTight ? 22 : s.avgTot <= 2.2 ? 8 : -28;
    case 'UNDER_3_5':
      return s.bothTight || (s.avgTot <= 2.4 && !s.bothAttack) ? 8 : -32;
    case 'UNDER_1_5':
      return s.avgTot <= 1.6 && s.bothUnderHeavy ? 16 : -28;
    case 'UNDER_4_5':
    case 'OVER_0_5':
    case 'UNDER_0_5':
    case 'OVER_4_5':
      return -28;
    case 'BTTS_YES':
      return (
        (h.btts + a.btts >= 6 ? 24 : 0) +
        (s.bothScore ? 22 : -8) +
        (s.bothAttack ? 12 : 0) +
        (h.lastBtts && a.lastBtts ? 14 : 0)
      );
    case 'BTTS_NO':
      return h.failedToScore >= 3 || a.failedToScore >= 3 ? 24 : h.lastBtts && a.lastBtts ? -20 : -12;
    case 'HOME':
    case 'AH_HOME_0':
    case 'AH_HOME_M05':
      return s.homeStrong && !s.awayStrong ? 48 : h.known && h.winRate - a.winRate >= 0.4 ? 26 : h.lastWin && !a.lastWin ? 10 : -10;
    case 'AWAY':
    case 'AH_AWAY_0':
      return s.awayStrong && !s.homeStrong ? 48 : a.known && a.winRate - h.winRate >= 0.4 ? 26 : a.lastWin && !h.lastWin ? 10 : -10;
    case 'DC_1X':
    case 'DNB_HOME':
    case 'AH_HOME_P05':
      return s.homeUnbeaten || (h.known && h.winRate >= 0.6 && h.gf >= a.gf)
        ? 36
        : h.wins >= 3
          ? 18
          : s.homeStrong
            ? 14
            : -6;
    case 'DC_X2':
    case 'DNB_AWAY':
      return s.awayStrong || s.awayUnbeaten ? 24 : a.wins >= 3 ? 10 : -8;
    case 'DC_12':
      return -18;
    case 'HOME_OVER_1_5':
    case 'HOME_OVER_0_5':
      return h.scored2 >= 3 || h.gf >= 1.8 ? 32 : h.lastGf >= 2 ? 18 : h.scored >= 4 ? 12 : -8;
    case 'AWAY_OVER_1_5':
    case 'AWAY_OVER_0_5':
      return a.scored2 >= 3 || a.gf >= 1.8 ? 32 : a.lastGf >= 2 ? 18 : a.scored >= 4 ? 12 : -8;
    case 'HOME_TO_SCORE':
      return h.scored >= Math.max(3, h.n - 1) && h.gf >= 1.2 ? 18 : -10;
    case 'AWAY_TO_SCORE':
      return a.scored >= Math.max(3, a.n - 1) && a.gf >= 1.2 ? 18 : -10;
    case 'DRAW':
      return s.evenMatch && Math.abs(h.wins - a.wins) <= 1 ? 12 : -14;
    case 'OVER_10_5_CORNERS':
      return s.bothAttack && s.avgTot >= 2.7 ? 22 : s.avgTot >= 2.8 ? 8 : -14;
    case 'UNDER_10_5_CORNERS':
      return s.bothTight && !s.lastOver && s.avgTot <= 2.15 ? 24 : s.lastOver || s.avgTot >= 2.6 ? -22 : -8;
    case 'OVER_3_5_CARDS':
      return s.evenMatch ? 20 : s.bothTight ? 10 : -10;
    case 'UNDER_3_5_CARDS':
      return s.homeStrong && !s.awayStrong && !s.evenMatch ? 16 : -12;
    case 'HOME_PLAYER_SCORE':
      return home.topScorer && home.topScorer.last5Goals >= 3 ? 28 : home.topScorer && home.topScorer.last5Goals >= 2 ? 14 : -20;
    case 'AWAY_PLAYER_SCORE':
      return away.topScorer && away.topScorer.last5Goals >= 3 ? 28 : away.topScorer && away.topScorer.last5Goals >= 2 ? 14 : -20;
    default:
      return 0;
  }
}

export function marketRank(
  m: { market: BetMarket; modelProbability: number; analysisScore: number; sampleDeliveryRate: number | null },
  home: TeamSnapshot,
  away: TeamSnapshot,
): number {
  const fit = styleFit(m.market, home, away);
  const sample = m.sampleDeliveryRate ?? 36;
  const lazyUnder = m.market === 'UNDER_2_5' && fit < 8;
  const lazy = LAZY_DEFAULTS.has(m.market) || lazyUnder || !PLAYABLE_MARKETS.has(m.market);
  return fit * 3.4 + sample * 0.32 + Math.min(m.modelProbability, 60) * 0.07 + m.analysisScore * 0.08 - (lazy ? 90 : 0);
}

function capabilityWhy(home: TeamSnapshot, away: TeamSnapshot, market: BetMarket): string[] {
  const s = formSignals(home, away);
  const { h, a } = s;
  const lastH = h.known ? `${home.name} last match ${h.lastGf} scored, ${h.lastTotal} total goals (${h.lastOver25 ? 'over' : 'under'} 2.5).` : `${home.name} last-match sample is UNKNOWN.`;
  const lastA = a.known ? `${away.name} last match ${a.lastGf} scored, ${a.lastTotal} total goals (${a.lastOver25 ? 'over' : 'under'} 2.5).` : `${away.name} last-match sample is UNKNOWN.`;
  const lines = [
    lastH,
    lastA,
    h.known && a.known
      ? `Last ${h.n}+${a.n}: ${home.name} ${h.gf} gf (${h.over25}/${h.n} over 2.5, ${h.wins} wins) vs ${away.name} ${a.gf} gf (${a.over25}/${a.n} over 2.5, ${a.wins} wins).`
      : 'Pick uses the games we have — missing results are not treated as 0-0.',
  ];
  if (market === 'UNDER_2_5' && (s.lastOver || s.eitherOverHeavy)) {
    lines.push('Under 2.5 is blocked: last match or recent over-2.5 rate does not support it.');
  } else if (s.lastOver && (market === 'OVER_2_5' || market === 'OVER_1_5' || market === 'OVER_10_5_CORNERS')) {
    lines.push('Last match went over 2.5 — pick follows that, not a blanket under.');
  } else if (s.homeStrong && (market === 'HOME' || market === 'DC_1X' || market === 'DNB_HOME')) {
    lines.push(`${home.name} recent wins favour home / 1X, not a default totals under.`);
  } else if (s.awayStrong && (market === 'AWAY' || market === 'DC_X2')) {
    lines.push(`${away.name} recent wins favour the away / X2 side.`);
  } else if (s.bothScore && market === 'BTTS_YES') {
    lines.push('Both sides scored in most recent games — BTTS follows that record.');
  } else if (market === 'HOME_PLAYER_SCORE' && home.topScorer) {
    lines.push(`${home.topScorer.name} scored ${home.topScorer.last5Goals} in the last-5 sample.`);
  } else if (market === 'AWAY_PLAYER_SCORE' && away.topScorer) {
    lines.push(`${away.topScorer.name} scored ${away.topScorer.last5Goals} in the last-5 sample.`);
  }
  return lines;
}

export function setRecommended(
  analysis: FixtureAnalysis,
  market: BetMarket,
  extra?: { reason?: string; why?: string[] },
): FixtureAnalysis {
  const hit = analysis.markets.find((m) => m.market === market);
  if (!hit) return analysis;
  const recommended = asPlay({
    ...hit,
    whyQualified: [...(extra?.why ?? []), ...hit.whyQualified].slice(0, 6),
    reason: extra?.reason ?? hit.reason,
  });
  const next: FixtureAnalysis = {
    ...analysis,
    recommended,
    markets: analysis.markets.map((m) => (m.market === recommended.market ? recommended : m)),
  };
  return { ...next, cardLines: cardMarketLines(next) };
}

function asPlay(m: MarketAnalysis): MarketAnalysis {
  if (m.category !== 'AVOID') return m;
  const { category, riskLevel } = playCategory({
    safety: m.analysisScore,
    edgePct: m.edgePct,
    odds: m.odds.bestOdds,
  });
  const why = m.whyQualified.length
    ? m.whyQualified
    : [
        `Best-supported market on this fixture (model ${m.modelProbability}%, score ${m.analysisScore}/100).`,
        m.historicalNote,
      ];
  return {
    ...m,
    category,
    riskLevel,
    reason: why.slice(0, 3).join(' '),
    whyQualified: why,
  };
}

function emptyBooks(note: string): BookOdds[] {
  return [
    { bookmaker: 'bet9ja', label: 'Bet9ja', decimalOdds: null, available: false, note },
    { bookmaker: 'sportybet', label: 'SportyBet', decimalOdds: null, available: false, note },
    { bookmaker: 'third', label: 'Third book', decimalOdds: null, available: false, note },
  ];
}

function packOdds(market: BetMarket, books: BookOdds[]): MarketOdds {
  const live = books.filter((b) => b.available && b.decimalOdds != null);
  let best: BookOdds | null = null;
  for (const b of live) {
    if (!best || (b.decimalOdds ?? 0) > (best.decimalOdds ?? 0)) best = b;
  }
  return {
    market,
    label: MARKET_LABELS[market] ?? market,
    books,
    bestBook: best?.bookmaker ?? null,
    bestOdds: best?.decimalOdds ?? null,
  };
}

function analysedOddsFromP(p: number): number | null {
  if (p < 0.08 || p > 0.97) return null;
  return Math.round((1 / p) * 100) / 100;
}

function formCard(t: TeamSnapshot): TeamFormCard {
  const played = Math.max(t.sampleSize ?? t.wins + t.draws + t.losses, 0);
  const recent = (t.recent ?? []).slice(0, 10).map((r) => ({
    opponent: r.opponent,
    gf: r.gf,
    ga: r.ga,
    isHome: r.isHome,
    result: (r.gf > r.ga ? 'W' : r.gf === r.ga ? 'D' : 'L') as 'W' | 'D' | 'L',
    playedAt: r.playedAt,
  }));
  return {
    name: t.name,
    last5: t.last5 || (played ? formStringFallback(recent, 5) : 'No results yet'),
    last10: t.last10 || t.last5 || (played ? formStringFallback(recent, 10) : 'No results yet'),
    played,
    wins: t.wins,
    draws: t.draws,
    losses: t.losses,
    gf: t.goalsFor,
    ga: t.goalsAgainst,
    avgGf: played ? Math.round((t.goalsFor / played) * 10) / 10 : 0,
    avgGa: played ? Math.round((t.goalsAgainst / played) * 10) / 10 : 0,
    reliability: t.dataReliability ?? (played ? 'LIMITED' : 'No results yet'),
    recent,
  };
}

function formStringFallback(recent: Array<{ result: string }>, n: number): string {
  return recent.slice(0, n).map((r) => r.result).join('') || 'No results yet';
}

function band(total: number): ScoreBreakdown['band'] {
  if (total >= 90) return 'Exceptional';
  if (total >= 80) return 'Strong';
  if (total >= 70) return 'Good';
  if (total >= 60) return 'Watch';
  return 'REJECT';
}

function analysisBreakdown(input: {
  home: TeamSnapshot;
  away: TeamSnapshot;
  marketP: number;
  sampleRate: number | null;
  lineupConfirmed: boolean;
  rotationRisk: LineupInfo['rotationRisk'];
  missing: number;
  cup: boolean;
  edgePct: number | null;
  contradictions: number;
}): ScoreBreakdown {
  const hp = input.home.sampleSize ?? input.home.wins + input.home.draws + input.home.losses;
  const ap = input.away.sampleSize ?? input.away.wins + input.away.draws + input.away.losses;
  const form = clamp(
    ((formScore(input.home.last5) +
      formScore(input.home.last10 || input.home.last5) +
      formScore(input.away.last5) +
      formScore(input.away.last10 || input.away.last5)) /
      4 /
      100) *
      10,
  );
  const homeWinPct =
    (input.home.homeSplit?.played ?? 0) >= 3
      ? (input.home.homeSplit!.wins / input.home.homeSplit!.played) * 10
      : 5;
  const awayWinPct =
    (input.away.awaySplit?.played ?? 0) >= 3
      ? (input.away.awaySplit!.wins / input.away.awaySplit!.played) * 10
      : 5;
  const homeAway = clamp((homeWinPct + (10 - Math.min(10, awayWinPct))) / 2);
  const gf = (input.home.goalsFor + input.away.goalsFor) / Math.max(hp + ap, 1);
  const goals = clamp(Math.min(10, gf * 3.2));
  const ga = (input.home.goalsAgainst + input.away.goalsAgainst) / Math.max(hp + ap, 1);
  const defense = clamp(Math.max(0, 10 - ga * 2.2));
  const delivery = input.sampleRate == null ? 2 : clamp((input.sampleRate / 100) * 10);
  const opponent = 3;
  const h2hPts = 3;
  let squad = input.lineupConfirmed ? 9 : 5;
  if (input.missing >= 3) squad = Math.max(1, squad - 4);
  if (input.rotationRisk === 'HIGH') squad = Math.max(1, squad - 3);
  if (input.rotationRisk === 'UNKNOWN' && !input.lineupConfirmed) squad = Math.min(squad, 5);
  const motivation = input.cup ? 6 : 7;
  const context = input.cup ? 3 : 4;
  const data =
    input.home.dataReliability === 'GOOD' && input.away.dataReliability === 'GOOD'
      ? 5
      : input.home.dataReliability === 'UNKNOWN' || input.away.dataReliability === 'UNKNOWN'
        ? 1
        : 3;
  const value = input.edgePct == null ? 2.5 : clamp(2.5 + Math.min(2.5, input.edgePct / 4));
  let total =
    form + homeAway + goals + defense + delivery + opponent + h2hPts + squad + motivation + context + data + value;
  total -= input.contradictions * 6;
  total = clamp(total);
  return {
    form: clamp(form, 0, 10),
    homeAway: clamp(homeAway, 0, 10),
    goals: clamp(goals, 0, 10),
    defense: clamp(defense, 0, 10),
    delivery: clamp(delivery, 0, 10),
    opponent: clamp(opponent, 0, 5),
    h2h: clamp(h2hPts, 0, 5),
    squad: clamp(squad, 0, 10),
    motivation: clamp(motivation, 0, 10),
    context: clamp(context, 0, 5),
    data: clamp(data, 0, 5),
    value: clamp(value, 0, 5),
    total,
    band: band(total),
  };
}

export function analyzeFixture(input: {
  fixture: FixtureSummary;
  home: TeamSnapshot;
  away: TeamSnapshot;
  h2hText: string;
  importance: string;
  lineup: LineupInfo;
  injuriesHome: string[];
  injuriesAway: string[];
  oddsByMarket?: Partial<Record<BetMarket, BookOdds[]>>;
  oddsNote: string;
  sources?: string[];
}): FixtureAnalysis {
  const homeForm = formScore(input.home.last5);
  const awayForm = formScore(input.away.last5);
  const homeStr = clamp(40 + homeForm * 0.35 + (input.home.homeWins ?? 0) * 4);
  const awayStr = clamp(40 + awayForm * 0.35 + (input.away.awayWins ?? 0) * 4);

  const sig = formSignals(input.home, input.away);
  const homeN = Math.max(input.home.wins + input.home.draws + input.home.losses, 1);
  const awayN = Math.max(input.away.wins + input.away.draws + input.away.losses, 1);
  const homeGf = sig.h.known ? sig.h.gf : Math.max(0.9, input.home.goalsFor / homeN);
  const homeGa = sig.h.known ? sig.h.ga : Math.max(0.8, input.home.goalsAgainst / homeN);
  const awayGf = sig.a.known ? sig.a.gf : Math.max(0.9, input.away.goalsFor / awayN);
  const awayGa = sig.a.known ? sig.a.ga : Math.max(0.8, input.away.goalsAgainst / awayN);

  let lambdaH = 0.62 * homeGf + 0.38 * awayGa;
  let lambdaA = 0.58 * awayGf + 0.32 * homeGa;
  if (!sig.h.known && !sig.a.known) {
    lambdaH = 1.35;
    lambdaA = 1.15;
  }
  if (!input.lineup.confirmed) {
    lambdaH *= 0.98;
    lambdaA *= 0.98;
  }
  lambdaH = Math.max(0.5, Math.min(3.5, lambdaH));
  lambdaA = Math.max(0.4, Math.min(3.1, lambdaA));
  const grid = scoreMatrix(lambdaH, lambdaA);
  const multiScore = buildMultiScorePick(grid, input.home.name, input.away.name, sig.homeStrong, sig.awayStrong);
  const htGrid = scoreMatrix(lambdaH * 0.45, lambdaA * 0.45);
  const pHtOver05 = sumWhere(htGrid, (h, a) => h + a >= 1);
  const halfTime = {
    label: 'Over 0.5',
    pct: Math.round(pHtOver05 * 100),
  };

  const pHome = sumWhere(grid, (h, a) => h > a);
  const pDraw = sumWhere(grid, (h, a) => h === a);
  const pAway = sumWhere(grid, (h, a) => h < a);
  const pOver = (n: number) => sumWhere(grid, (h, a) => h + a > n);
  const pBttsY = sumWhere(grid, (h, a) => h > 0 && a > 0);
  const pHomeScore = sumWhere(grid, (h) => h > 0);
  const pAwayScore = sumWhere(grid, (_h, a) => a > 0);
  const pHomeOver15 = sumWhere(grid, (h) => h > 1);
  const pAwayOver15 = sumWhere(grid, (_h, a) => a > 1);
  const pDnbH = pHome + pAway > 0 ? pHome / (pHome + pAway) : 0.5;
  const pDnbA = pHome + pAway > 0 ? pAway / (pHome + pAway) : 0.5;

  const missing =
    input.lineup.missingHome.length +
    input.lineup.missingAway.length +
    input.injuriesHome.length +
    input.injuriesAway.length;
  const cup = /champions|europa|conference|cup|pokal|copa|coppa/i.test(input.fixture.league);

  const avoidReasons: string[] = [];
  if (!input.lineup.confirmed) {
    avoidReasons.push('Official starting XI not confirmed — treated as UNKNOWN, not assumed.');
  }
  if (missing >= 3) avoidReasons.push('Several named absences — squad quality is reduced.');
  if (Math.abs(homeForm - awayForm) < 8 && Math.abs(homeStr - awayStr) < 8) {
    avoidReasons.push('Team strength and form are close — conflicting signals.');
  }
  if ((input.home.sampleSize ?? homeN) < 4 || (input.away.sampleSize ?? awayN) < 4) {
    avoidReasons.push('Recent-form sample is too small — data reliability is limited.');
  }
  if (input.home.popular && homeForm < 40) {
    avoidReasons.push(`${input.home.name} is popular but recent form fails the criteria — not recommended for fame.`);
  }
  if (input.away.popular && awayForm < 40) {
    avoidReasons.push(`${input.away.name} is popular but recent form fails the criteria — not recommended for fame.`);
  }

  const h2h = input.h2hText || h2hNote(input.home, input.away);
  const sources = input.sources ?? [
    'TheSportsDB (fixtures/livescore)',
    'FotMob (last 5/10 results — not invented)',
    input.oddsNote.includes('Odds API') ? 'The Odds API (guide prices, not Bet9ja/SportyBet)' : 'No bookmaker odds feed',
    'Model: Poisson from recent goals; unknown fields marked UNKNOWN',
  ];

  const model: Array<{ market: BetMarket; p: number }> = [
    { market: 'HOME', p: pHome },
    { market: 'DRAW', p: pDraw },
    { market: 'AWAY', p: pAway },
    { market: 'DC_1X', p: pHome + pDraw },
    { market: 'DC_X2', p: pAway + pDraw },
    { market: 'DC_12', p: pHome + pAway },
    { market: 'DNB_HOME', p: pDnbH },
    { market: 'DNB_AWAY', p: pDnbA },
    { market: 'OVER_0_5', p: pOver(0) },
    { market: 'OVER_1_5', p: pOver(1) },
    { market: 'OVER_2_5', p: pOver(2) },
    { market: 'OVER_3_5', p: pOver(3) },
    { market: 'OVER_4_5', p: pOver(4) },
    { market: 'UNDER_0_5', p: 1 - pOver(0) },
    { market: 'UNDER_1_5', p: 1 - pOver(1) },
    { market: 'UNDER_2_5', p: 1 - pOver(2) },
    { market: 'UNDER_3_5', p: 1 - pOver(3) },
    { market: 'UNDER_4_5', p: 1 - pOver(4) },
    { market: 'BTTS_YES', p: pBttsY },
    { market: 'BTTS_NO', p: 1 - pBttsY },
    { market: 'HOME_TO_SCORE', p: pHomeScore },
    { market: 'AWAY_TO_SCORE', p: pAwayScore },
    { market: 'HOME_OVER_0_5', p: pHomeScore },
    { market: 'HOME_OVER_1_5', p: pHomeOver15 },
    { market: 'AWAY_OVER_0_5', p: pAwayScore },
    { market: 'AWAY_OVER_1_5', p: pAwayOver15 },
    { market: 'AH_HOME_0', p: pHome },
    { market: 'AH_AWAY_0', p: pAway },
    { market: 'AH_HOME_M05', p: pHome },
    { market: 'AH_HOME_P05', p: pHome + pDraw },
    { market: 'AH_HOME_M15', p: sumWhere(grid, (h, a) => h >= a + 2) },
    { market: 'AH_HOME_P15', p: sumWhere(grid, (h, a) => a < h + 2) },
    { market: 'OVER_10_5_CORNERS', p: poissonOver(sig.estCorners, 10.5) },
    { market: 'UNDER_10_5_CORNERS', p: 1 - poissonOver(sig.estCorners, 10.5) },
    { market: 'OVER_3_5_CARDS', p: poissonOver(sig.estCards, 3.5) },
    { market: 'UNDER_3_5_CARDS', p: 1 - poissonOver(sig.estCards, 3.5) },
  ];
  if (input.home.topScorer && input.home.topScorer.last5Goals >= 1) {
    model.push({
      market: 'HOME_PLAYER_SCORE',
      p: Math.min(0.72, 0.22 + input.home.topScorer.last5Goals * 0.11),
    });
  }
  if (input.away.topScorer && input.away.topScorer.last5Goals >= 1) {
    model.push({
      market: 'AWAY_PLAYER_SCORE',
      p: Math.min(0.72, 0.22 + input.away.topScorer.last5Goals * 0.11),
    });
  }

  const markets: MarketAnalysis[] = model.map((row) => {
    const odds = packOdds(
      row.market,
      input.oddsByMarket?.[row.market] ?? emptyBooks(input.oddsNote),
    );
    const implied = impliedProb(odds.bestOdds);
    const edgePct = implied == null ? null : Math.round((row.p - implied) * 1000) / 10;
    const sample = sampleDelivery(row.market, input.home, input.away);
    const resultMarket = /^(HOME|DRAW|AWAY|DC_|DNB_|AH_)/.test(row.market);
    const contradictions =
      (missing >= 3 ? 1 : 0) +
      (resultMarket && Math.abs(homeForm - awayForm) < 8 && Math.abs(homeStr - awayStr) < 8 ? 1 : 0) +
      (sample.rate != null && sample.rate < 45 && row.p > 0.7 ? 1 : 0);
    const breakdown = analysisBreakdown({
      home: input.home,
      away: input.away,
      marketP: row.p,
      sampleRate: sample.rate,
      lineupConfirmed: input.lineup.confirmed,
      rotationRisk: input.lineup.rotationRisk,
      missing,
      cup,
      edgePct,
      contradictions,
    });
    const analysisScore = breakdown.total;
    const confidence = clamp(Math.min(analysisScore, row.p * 100, 92));
    const reject =
      analysisScore < 70 ||
      (implied != null && row.p < 0.28 && (odds.bestOdds ?? 1) > 5) ||
      confidence < 70;
    const { category, riskLevel } = categorize({
      safety: analysisScore,
      edgePct,
      odds: odds.bestOdds ?? analysedOddsFromP(row.p),
      avoid: reject,
    });
    const why: string[] = [];
    if (row.p >= 0.7) why.push(`Model probability ${Math.round(row.p * 100)}%.`);
    if (sample.rate != null) why.push(`Sample delivery ${sample.rate}% (${sample.note})`);
    else why.push(sample.note);
    why.push(`100-point score ${analysisScore} (${breakdown.band}).`);
    if (input.home.popular || input.away.popular) {
      why.push('Popularity is a filter only and was not added to the score.');
    }
    if (edgePct != null) why.push(`Guide-price edge ${edgePct}% (not Bet9ja/SportyBet).`);
    const mainRisk =
      avoidReasons[0] ??
      (sample.rate == null
        ? 'Delivery sample is UNKNOWN for this market.'
        : 'Line-up, motivation, or opponent quality can still break a high historical rate.');

    return {
      market: row.market,
      label:
        row.market === 'HOME_PLAYER_SCORE' && input.home.topScorer
          ? `${input.home.topScorer.name} to score`
          : row.market === 'AWAY_PLAYER_SCORE' && input.away.topScorer
            ? `${input.away.topScorer.name} to score`
            : MARKET_LABELS[row.market] ?? row.market,
      modelProbability: Math.round(row.p * 1000) / 10,
      impliedProbability: implied == null ? null : Math.round(implied * 1000) / 10,
      edgePct,
      safetyScore: analysisScore,
      analysisScore,
      confidence,
      sampleDeliveryRate: sample.rate,
      sampleSize: sample.sample,
      historicalNote: sample.note,
      analysedOdds: analysedOddsFromP(row.p),
      odds,
      category,
      riskLevel,
      reason:
        category === 'AVOID'
          ? avoidReasons[0] ?? `Score ${analysisScore}/100 is weaker than the fixture pick — still listed for comparison.`
          : why.slice(0, 3).join(' '),
      whyQualified: category === 'AVOID' ? [] : why,
      mainRisk,
      sources,
      breakdown,
    };
  });

  const pool = markets.filter((m) => PLAYABLE_MARKETS.has(m.market));
  const ranked = [...(pool.length ? pool : markets)].sort(
    (a, b) => marketRank(b, input.home, input.away) - marketRank(a, input.home, input.away) || b.confidence - a.confidence,
  );
  const pick = ranked[0]!;
  const capWhy = capabilityWhy(input.home, input.away, pick.market);
  const recommended = asPlay({
    ...pick,
    whyQualified: [...capWhy, ...pick.whyQualified].slice(0, 6),
    reason: capWhy.concat(pick.reason).slice(0, 3).join(' '),
  });
  const marketsOut = markets.map((m) => (m.market === recommended.market ? recommended : m));
  const rankedMarkets = ranked.map((m) => m.market);

  const half = (['OVER_2_5', 'OVER_1_5', 'UNDER_2_5', 'OVER_3_5', 'BTTS_YES'] as BetMarket[])
    .map((m) => marketsOut.find((x) => x.market === m)!)
    .filter(Boolean)
    .sort((a, b) => marketRank(b, input.home, input.away) - marketRank(a, input.home, input.away))[0];

  const analysis: FixtureAnalysis = {
    fixture: input.fixture,
    popularity: {
      home: input.home.popular,
      away: input.away.popular,
      note: 'Popularity is a filter only. It is not added to the safety score and cannot promote a weak bet.',
    },
    strength: {
      home: homeStr,
      away: awayStr,
      note: `Attack/defence proxy from recent goals. Home ${homeStr}/100 vs away ${awayStr}/100.`,
    },
    form: {
      home: input.home.last5 || 'No results yet',
      away: input.away.last5 || 'No results yet',
      last10Home: input.home.last10 || input.home.last5 || 'No results yet',
      last10Away: input.away.last10 || input.away.last5 || 'No results yet',
    },
    teamStats: { home: formCard(input.home), away: formCard(input.away) },
    homeAway: `Home games ${input.home.homeSplit?.wins ?? 0}W-${input.home.homeSplit?.draws ?? 0}D-${input.home.homeSplit?.losses ?? 0}L (${input.home.homeSplit?.played ?? 0} played). Away games ${input.away.awaySplit?.wins ?? 0}W-${input.away.awaySplit?.draws ?? 0}D-${input.away.awaySplit?.losses ?? 0}L (${input.away.awaySplit?.played ?? 0} played).`,
    h2h,
    sources,
    noBet: false,
    goals: {
      homeFor: input.home.goalsFor,
      homeAgainst: input.home.goalsAgainst,
      awayFor: input.away.goalsFor,
      awayAgainst: input.away.goalsAgainst,
    },
    injuries: {
      home: input.injuriesHome,
      away: input.injuriesAway,
      note: input.injuriesHome.length + input.injuriesAway.length
        ? 'Named absences reduce line-up strength.'
        : 'UNKNOWN — no injury/suspension feed. Not treated as a clear bill of health.',
    },
    lineup: input.lineup,
    matchImportance: input.importance,
    halfGoalPick: half
      ? {
          market: half.market,
          label: half.label,
          reason: `Form pick: ${half.label} (${half.analysisScore}/100, model ${half.modelProbability}%). Not a guarantee.`,
        }
      : null,
    halfTime,
    markets: marketsOut,
    recommended,
    rankedMarkets,
    multiScore,
    avoidReasons,
    disclaimer: BET_DISCLAIMER,
  };
  return { ...analysis, cardLines: cardMarketLines(analysis) };
}

export type { CardMarketLine } from './types';

function shortMarketDetail(m: MarketAnalysis): string {
  if (m.market === 'HOME') return 'Home to win';
  if (m.market === 'AWAY') return 'Away to win';
  if (m.market === 'BTTS_YES') return 'BTTS yes';
  if (m.market === 'BTTS_NO') return 'BTTS no';
  if (m.market === 'OVER_2_5') return 'Over 2.5';
  if (m.market === 'UNDER_2_5') return 'Under 2.5';
  return m.label
    .replace(/\s+goals$/i, '')
    .replace(/^Double chance /i, 'DC ')
    .replace(/\s+corners$/i, '')
    .replace(/\s+cards$/i, '');
}

function linePct(m: MarketAnalysis): number {
  const n = Math.round(m.analysisScore ?? m.safetyScore ?? m.modelProbability);
  return Number.isFinite(n) ? n : 0;
}

function bestIn(markets: MarketAnalysis[], ids: BetMarket[]): MarketAnalysis | null {
  const rows = markets.filter((m) => ids.includes(m.market));
  if (!rows.length) return null;
  return [...rows].sort((a, b) => linePct(b) - linePct(a))[0] ?? null;
}

const EXTRA_BUCKETS: BetMarket[][] = [
  ['BTTS_YES', 'BTTS_NO'],
  ['OVER_2_5', 'UNDER_2_5'],
  ['OVER_1_5', 'UNDER_1_5'],
  ['DC_1X', 'DC_X2', 'DC_12'],
  ['HOME_OVER_1_5', 'AWAY_OVER_1_5'],
  ['OVER_10_5_CORNERS', 'UNDER_10_5_CORNERS'],
  ['HOME', 'DRAW', 'AWAY', 'DNB_HOME', 'DNB_AWAY'],
  ['OVER_3_5', 'UNDER_3_5'],
  ['HOME_TO_SCORE', 'AWAY_TO_SCORE'],
  ['OVER_3_5_CARDS', 'UNDER_3_5_CARDS'],
];

function cardFamilyKey(market: BetMarket): string {
  if (market === 'HOME' || market === 'DRAW' || market === 'AWAY') return 'result';
  if (market.startsWith('DC_') || market.startsWith('DNB_') || market.startsWith('AH_')) return 'result';
  if (market.startsWith('BTTS')) return 'btts';
  if (market === 'OVER_2_5' || market === 'UNDER_2_5') return 'ou25';
  if (market === 'OVER_1_5' || market === 'UNDER_1_5') return 'ou15';
  if (market === 'OVER_3_5' || market === 'UNDER_3_5') return 'ou35';
  if (market === 'OVER_0_5' || market === 'UNDER_0_5') return 'ou05';
  if (market === 'OVER_4_5' || market === 'UNDER_4_5') return 'ou45';
  if (market.includes('CORNER')) return 'corners';
  if (market.includes('CARD')) return 'cards';
  if (market.includes('PLAYER')) return 'player';
  if (market.startsWith('HOME_')) return 'home-goals';
  if (market.startsWith('AWAY_')) return 'away-goals';
  return market;
}

function extraCardRow(m: MarketAnalysis): { family: string; pct: number; detail: string } {
  const pct = linePct(m);
  switch (m.market) {
    case 'BTTS_YES':
      return { family: 'BTTS', pct, detail: 'yes' };
    case 'BTTS_NO':
      return { family: 'BTTS', pct, detail: 'no' };
    case 'OVER_2_5':
      return { family: 'Over 2.5', pct, detail: 'Yes' };
    case 'UNDER_2_5':
      return { family: 'Under 2.5', pct, detail: 'Yes' };
    case 'OVER_1_5':
      return { family: 'Over 1.5', pct, detail: 'Yes' };
    case 'UNDER_1_5':
      return { family: 'Under 1.5', pct, detail: 'Yes' };
    case 'OVER_3_5':
      return { family: 'Over 3.5', pct, detail: 'Yes' };
    case 'UNDER_3_5':
      return { family: 'Under 3.5', pct, detail: 'Yes' };
    case 'OVER_0_5':
      return { family: 'Over 0.5', pct, detail: 'Yes' };
    case 'HOME':
      return { family: '1X2', pct, detail: 'Home to win' };
    case 'DRAW':
      return { family: '1X2', pct, detail: 'Draw' };
    case 'AWAY':
      return { family: '1X2', pct, detail: 'Away to win' };
    case 'DC_1X':
      return { family: 'Double chance', pct, detail: '1X' };
    case 'DC_X2':
      return { family: 'Double chance', pct, detail: 'X2' };
    case 'DC_12':
      return { family: 'Double chance', pct, detail: '12' };
    case 'DNB_HOME':
      return { family: 'Draw no bet', pct, detail: 'Home' };
    case 'DNB_AWAY':
      return { family: 'Draw no bet', pct, detail: 'Away' };
    case 'HOME_OVER_1_5':
      return { family: 'Home over 1.5', pct, detail: 'Yes' };
    case 'AWAY_OVER_1_5':
      return { family: 'Away over 1.5', pct, detail: 'Yes' };
    case 'HOME_TO_SCORE':
      return { family: 'Home to score', pct, detail: 'Yes' };
    case 'AWAY_TO_SCORE':
      return { family: 'Away to score', pct, detail: 'Yes' };
    case 'OVER_10_5_CORNERS':
      return { family: 'Corners', pct, detail: 'Over 10.5' };
    case 'UNDER_10_5_CORNERS':
      return { family: 'Corners', pct, detail: 'Under 10.5' };
    case 'OVER_3_5_CARDS':
      return { family: 'Cards', pct, detail: 'Over 3.5' };
    case 'UNDER_3_5_CARDS':
      return { family: 'Cards', pct, detail: 'Under 3.5' };
    case 'HOME_PLAYER_SCORE':
      return { family: 'Player to score', pct, detail: 'Home' };
    case 'AWAY_PLAYER_SCORE':
      return { family: 'Player to score', pct, detail: 'Away' };
    default:
      return { family: shortMarketDetail(m), pct, detail: m.label || 'Yes' };
  }
}

function safestDetail(m: MarketAnalysis): string {
  const row = extraCardRow(m);
  if (/^btts$/i.test(row.family)) return `BTTS ${row.detail}`.trim();
  if (row.detail && !/^(yes|no)$/i.test(row.detail.trim()) && row.family.toLowerCase() !== row.detail.toLowerCase()) {
    return `${row.family} ${row.detail}`.trim();
  }
  return row.family || shortMarketDetail(m);
}

/**
 * Safest plus this match’s next-best other markets (each with % and value).
 * The Safest line is always `recommended` — never the highest raw analysisScore.
 * Multiscore is not included — that line belongs on the Multiscore tab.
 */
export function cardMarketLines(analysis: FixtureAnalysis): Array<{ family: string; pct: number; detail: string }> {
  const lines: Array<{ family: string; pct: number; detail: string }> = [];
  const used = new Set<string>();
  const rec = analysis.recommended;
  if (rec) {
    lines.push({
      family: 'Safest',
      pct: linePct(rec),
      detail: safestDetail(rec),
    });
    used.add(cardFamilyKey(rec.market));
  }
  for (const bucket of EXTRA_BUCKETS) {
    if (lines.length >= 4) break;
    const best = bestIn(analysis.markets, bucket);
    if (!best) continue;
    const key = cardFamilyKey(best.market);
    if (used.has(key)) continue;
    used.add(key);
    const row = extraCardRow(best);
    if (!row.detail.trim()) continue;
    lines.push(row);
  }
  return lines;
}

/** Fixture detail: recommended (Safest) first, then the same rank order used to pick it. */
export function orderPlayableMarkets(
  markets: Array<{ market: BetMarket; category: string; analysisScore?: number; safetyScore?: number }>,
  recommended: { market: BetMarket } | null,
  rankedMarkets?: BetMarket[],
): typeof markets {
  const playable = markets.filter((m) => m.category !== 'AVOID');
  const rankOf = (market: BetMarket) => {
    if (recommended && market === recommended.market) return -1;
    const i = rankedMarkets?.indexOf(market);
    return i != null && i >= 0 ? i : 999;
  };
  return [...playable].sort(
    (a, b) =>
      rankOf(a.market) - rankOf(b.market) ||
      (b.analysisScore ?? b.safetyScore ?? 0) - (a.analysisScore ?? a.safetyScore ?? 0),
  );
}

function marketFamily(market: BetMarket): string {
  if (market.includes('CORNER')) return 'corners';
  if (market.includes('CARD')) return 'cards';
  if (market.includes('PLAYER')) return 'player';
  if (market.startsWith('OVER_') || market.startsWith('UNDER_')) return 'totals';
  if (market.startsWith('BTTS')) return 'btts';
  if (
    market === 'HOME' ||
    market === 'DC_1X' ||
    market === 'DNB_HOME' ||
    market.startsWith('HOME_OVER') ||
    market === 'HOME_TO_SCORE'
  ) {
    return 'home';
  }
  if (
    market === 'AWAY' ||
    market === 'DC_X2' ||
    market === 'DNB_AWAY' ||
    market.startsWith('AWAY_OVER') ||
    market === 'AWAY_TO_SCORE'
  ) {
    return 'away';
  }
  return market;
}

/** Booking/acca only: spread markets across a slip. Never use this for the per-match Safest card. */
export function diversifyRecommended(analyses: FixtureAnalysis[]): FixtureAnalysis[] {
  const usedMarket = new Map<string, number>();
  const usedFamily = new Map<string, number>();
  return analyses.map((a) => {
    const rec = a.recommended?.market;
    const order = [rec, ...(a.rankedMarkets ?? []).filter((m) => m !== rec)].filter(Boolean) as BetMarket[];
    let chosen = order[0] ?? rec;
    for (const m of order) {
      const fam = marketFamily(m);
      if ((usedMarket.get(m) ?? 0) < 2 && (usedFamily.get(fam) ?? 0) < 3) {
        chosen = m;
        break;
      }
    }
    if (!chosen) return a;
    usedMarket.set(chosen, (usedMarket.get(chosen) ?? 0) + 1);
    const fam = marketFamily(chosen);
    usedFamily.set(fam, (usedFamily.get(fam) ?? 0) + 1);
    if (chosen === a.recommended?.market) return a;
    const hit = a.markets.find((m) => m.market === chosen);
    return setRecommended(a, chosen, {
      reason: hit?.reason,
      why: [
        `This match’s stats support ${MARKET_LABELS[chosen] ?? chosen} — the pack is not a blanket Over 2.5.`,
        ...(hit?.whyQualified ?? []).slice(0, 3),
      ],
    });
  });
}

const HIGH_ODDS_SKIP = new Set<BetMarket>([
  'OVER_0_5',
  'UNDER_0_5',
  'UNDER_4_5',
  'DC_12',
  'HOME_TO_SCORE',
  'AWAY_TO_SCORE',
]);

function marketPrice(m: MarketAnalysis): number {
  if (m.odds.bestOdds != null && m.odds.bestOdds > 1) return m.odds.bestOdds;
  if (m.analysedOdds != null && m.analysedOdds > 1) return m.analysedOdds;
  if (m.modelProbability >= 8 && m.modelProbability <= 92) {
    return Math.round((100 / m.modelProbability) * 100) / 100;
  }
  return 0;
}

/** Longer-priced market for the High odds tab — not the same safest pick. */
export function pickHighOddsMarket(markets: MarketAnalysis[]): MarketAnalysis | null {
  const ranked = [...markets]
    .filter((m) => PLAYABLE_MARKETS.has(m.market) && !HIGH_ODDS_SKIP.has(m.market))
    .map((m) => ({ m, price: marketPrice(m) }))
    .filter((x) => x.price >= 1.9)
    .sort((a, b) => b.price - a.price || (b.m.analysisScore ?? 0) - (a.m.analysisScore ?? 0));
  const hit = ranked.find((x) => x.price >= 2.15) ?? ranked[0];
  if (!hit) return null;
  return asPlay({
    ...hit.m,
    analysedOdds: hit.m.analysedOdds ?? hit.price,
    category: 'HIGH_ODDS',
    riskLevel: hit.m.analysisScore >= 70 ? 'Qualified' : 'Value',
  });
}
