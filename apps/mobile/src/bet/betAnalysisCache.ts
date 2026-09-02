import type { BetFixtureAnalysis } from '../api/client';

export type BetCardAnalysis = {
  fixtureId: string;
  matchKey: string;
  cardLines?: Array<{ family: string; pct: number; detail: string }>;
  score?: number;
  label?: string;
};

const cardCache = new Map<string, BetCardAnalysis>();
const detailCache = new Map<string, BetFixtureAnalysis>();

export function betMatchKey(home?: string, away?: string, kickoffUtc?: string): string {
  const fold = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(fc|cf|afc|sc|ac|ssc|ud|cd|the)\b/g, '')
      .replace(/[^a-z0-9]+/g, '');
  return `${fold(home || '')}|${fold(away || '')}|${(kickoffUtc || '').slice(0, 10)}`;
}

function rememberCard(entry: BetCardAnalysis) {
  cardCache.set(entry.fixtureId, entry);
  if (entry.matchKey) cardCache.set(entry.matchKey, entry);
}

export function rememberBetFixtureAnalysis(data: BetFixtureAnalysis) {
  const fixtureId = data.fixture.id;
  const matchKey = betMatchKey(data.fixture.home.name, data.fixture.away.name, data.fixture.kickoffUtc);
  detailCache.set(fixtureId, data);
  detailCache.set(matchKey, data);
  rememberCard({
    fixtureId,
    matchKey,
    cardLines: data.cardLines,
    score: data.recommended?.analysisScore ?? data.recommended?.safetyScore,
    label: data.recommended?.label,
  });
}

export function rememberBetPick(p: {
  fixtureId: string;
  home?: string;
  away?: string;
  kickoffUtc?: string;
  cardLines?: Array<{ family: string; pct: number; detail: string }>;
  analysisScore?: number;
  safetyScore?: number;
  label?: string;
}) {
  rememberCard({
    fixtureId: p.fixtureId,
    matchKey: betMatchKey(p.home, p.away, p.kickoffUtc),
    cardLines: p.cardLines,
    score: p.analysisScore ?? p.safetyScore,
    label: p.label,
  });
}

export function lookupBetFixtureDetail(fixtureId: string, matchKey?: string): BetFixtureAnalysis | undefined {
  return detailCache.get(fixtureId) ?? (matchKey ? detailCache.get(matchKey) : undefined);
}

export function lookupBetCardAnalysis(fixtureId: string, matchKey?: string): BetCardAnalysis | undefined {
  return cardCache.get(fixtureId) ?? (matchKey ? cardCache.get(matchKey) : undefined);
}
