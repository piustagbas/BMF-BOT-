import { HIGH_DELIVERY_MARKETS, isReliableLeague, leagueFamily, compareByMatchDay, matchDayRank } from './popular';
import type { BetMarket, BookmakerId, FixtureSummary } from './types';

export type BookingCandidate = {
  fixtureId: string;
  home: string;
  away: string;
  match: string;
  kickoffUtc: string;
  league: string;
  popularMatch?: boolean;
  deliveryRate: number;
  market: BetMarket;
  label: string;
  modelProbability: number;
  safetyScore: number;
  analysisScore?: number;
  confidence?: number;
  sampleDeliveryRate?: number | null;
  category: string;
  riskLevel: string;
  reason: string;
  odds: { bestOdds: number | null };
  analysedOdds?: number | null;
  country?: string;
  countryFlag?: string;
  leagueHeading?: string;
  last5Home?: string;
  last5Away?: string;
  scoresHome?: string;
  scoresAway?: string;
  cardLines?: Array<{ family: string; pct: number; detail: string }>;
};

export type BookmakerSlip = {
  id: BookmakerId;
  label: string;
  site: string | null;
  how: string;
  bookingCode: null;
  copyText: string;
  avgSafety: number;
  avgDelivery: number;
  legs: Array<{
    fixtureId: string;
    match: string;
    pick: string;
    safety: number;
    country?: string;
    countryFlag?: string;
    league?: string;
    leagueHeading?: string;
    cardLines?: Array<{ family: string; pct: number; detail: string }>;
  }>;
};

const BOOKS: Array<{ id: BookmakerId; label: string; site: string | null; how: string }> = [
  {
    id: 'bet9ja',
    label: 'Bet9ja',
    site: 'https://www.bet9ja.com',
    how: 'Open Bet9ja → search each match → select the market on this slip. Paste is for the coupon, not a booking code.',
  },
  {
    id: 'sportybet',
    label: 'SportyBet',
    site: 'https://www.sportybet.com',
    how: 'Open SportyBet → search each match → select the market on this slip. Paste is for the coupon, not a booking code.',
  },
  {
    id: 'third',
    label: 'Third book',
    site: null,
    how: 'Enter the same matches and markets on your other book if they are listed.',
  },
];

/** Today first, then tomorrow, then later — still round-robin leagues inside each day. */
export function diverseFixtures(items: FixtureSummary[], max = 8, now = new Date()): FixtureSummary[] {
  const buckets: FixtureSummary[][] = [[], [], []];
  for (const f of items) {
    buckets[matchDayRank(f.kickoffUtc, now)]!.push(f);
  }
  const out: FixtureSummary[] = [];
  for (const bucket of buckets) {
    for (const f of roundRobinLeagues(bucket)) {
      out.push(f);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function roundRobinLeagues(items: FixtureSummary[]): FixtureSummary[] {
  const byLeague = new Map<string, FixtureSummary[]>();
  for (const f of items) {
    const k = leagueFamily(f.league);
    const arr = byLeague.get(k) ?? [];
    arr.push(f);
    byLeague.set(k, arr);
  }
  const out: FixtureSummary[] = [];
  const leagues = [...byLeague.keys()];
  let round = 0;
  while (true) {
    let added = false;
    for (const lg of leagues) {
      const row = byLeague.get(lg)?.[round];
      if (row) {
        out.push(row);
        added = true;
      }
    }
    if (!added) break;
    round += 1;
  }
  return out;
}

function scoreOf(m: BookingCandidate): number {
  return m.analysisScore ?? m.safetyScore;
}

function deliveryScore(m: BookingCandidate): number {
  return (m.sampleDeliveryRate ?? m.deliveryRate) * (scoreOf(m) / 100);
}

export function analysedPrice(m: BookingCandidate): number | null {
  if (m.odds.bestOdds != null && m.odds.bestOdds > 1) return m.odds.bestOdds;
  if (m.analysedOdds != null && m.analysedOdds > 1) return m.analysedOdds;
  if (m.modelProbability >= 8 && m.modelProbability <= 97) {
    return Math.round((100 / m.modelProbability) * 100) / 100;
  }
  return null;
}

function combinedPrice(legs: BookingCandidate[]): number | null {
  const prices = legs.map(analysedPrice).filter((n): n is number => n != null && n > 1);
  if (prices.length !== legs.length || !prices.length) return null;
  return Math.round(prices.reduce((a, b) => a * b, 1) * 100) / 100;
}

function pickUnique(ranked: BookingCandidate[], maxLegs: number): BookingCandidate[] {
  const usedMatch = new Set<string>();
  const usedLeague = new Set<string>();
  const usedMarket = new Set<string>();
  const legs: BookingCandidate[] = [];

  for (const m of ranked) {
    if (usedMatch.has(m.fixtureId)) continue;
    const family = leagueFamily(m.league);
    if (usedLeague.has(family) || usedMarket.has(m.market)) continue;
    usedMatch.add(m.fixtureId);
    usedLeague.add(family);
    usedMarket.add(m.market);
    legs.push(m);
    if (legs.length >= maxLegs) return legs;
  }

  for (const m of ranked) {
    if (usedMatch.has(m.fixtureId)) continue;
    const family = leagueFamily(m.league);
    if (usedLeague.has(family)) continue;
    usedMatch.add(m.fixtureId);
    usedLeague.add(family);
    legs.push(m);
    if (legs.length >= maxLegs) return legs;
  }

  for (const m of ranked) {
    if (usedMatch.has(m.fixtureId)) continue;
    usedMatch.add(m.fixtureId);
    legs.push(m);
    if (legs.length >= maxLegs) break;
  }
  return legs;
}

/**
 * One market per match, mixed reliable leagues, ranked by model delivery rate.
 * Does not dump every fixture onto a slip.
 */
export function selectBookingLegs(
  markets: BookingCandidate[],
  maxLegs = 5,
  opts?: { trustInputMarkets?: boolean },
) {
  const allowed = new Set<string>(HIGH_DELIVERY_MARKETS);
  const marketOk = (m: BookingCandidate) => opts?.trustInputMarkets || allowed.has(m.market);
  const inLeague = (m: BookingCandidate) => isReliableLeague(m.league);
  const ranked = (rows: BookingCandidate[]) =>
    [...rows].sort((a, b) => compareByMatchDay(a.kickoffUtc, b.kickoffUtc) || deliveryScore(b) - deliveryScore(a));

  const strict = markets.filter(
    (m) =>
      marketOk(m) &&
      inLeague(m) &&
      m.category !== 'AVOID' &&
      scoreOf(m) >= 70 &&
      (m.sampleDeliveryRate ?? m.deliveryRate) >= 52,
  );
  let legs = pickUnique(ranked(strict), maxLegs);

  if (legs.length < 3) {
    const fallback = markets.filter(
      (m) => marketOk(m) && inLeague(m) && m.deliveryRate >= 55 && m.safetyScore >= 48,
    );
    legs = pickUnique(ranked(fallback), maxLegs);
  }

  if (legs.length < 1) {
    const anySafe = markets.filter((m) => inLeague(m) && m.category !== 'AVOID' && m.safetyScore >= 40);
    legs = pickUnique(ranked(anySafe), maxLegs);
  }

  if (legs.length < 1) {
    legs = pickUnique(ranked(markets.filter((m) => inLeague(m))), maxLegs);
  }

  if (legs.length < 1) {
    legs = pickUnique(ranked(markets), maxLegs);
  }

  legs.sort((a, b) => compareByMatchDay(a.kickoffUtc, b.kickoffUtc));

  return {
    legs,
    note: 'One pick per match from the highest-delivery market. Confirm prices on Bet9ja/SportyBet. Not a guarantee. Booking codes are never invented.',
    bookSlips: formatBookmakerSlips(legs),
    accumulators: buildAccumulators(markets),
    daily100: buildDailyOddsSlip(markets, 100),
  };
}

/** High-delivery legs aiming at combined analysed odds ~100. Always returns a slip when prices exist. */
export function buildDailyOddsSlip(markets: BookingCandidate[], target = 100) {
  const playable = [...markets].filter(
    (m) => isReliableLeague(m.league) || markets.every((x) => !isReliableLeague(x.league)),
  );
  const ranked = [...playable]
    .filter((m) => {
      const p = analysedPrice(m);
      const deliv = m.sampleDeliveryRate ?? m.deliveryRate;
      return (
        m.category !== 'AVOID' &&
        scoreOf(m) >= 70 &&
        deliv >= 70 &&
        p != null &&
        p >= 1.12 &&
        p <= 1.7
      );
    })
    .sort((a, b) => deliveryScore(b) - deliveryScore(a));
  let pool = ranked;
  if (!pool.length) {
    pool = [...playable]
      .filter((m) => analysedPrice(m) != null)
      .sort((a, b) => deliveryScore(b) - deliveryScore(a));
  }
  const legs: BookingCandidate[] = [];
  const used = new Set<string>();
  for (const m of pool) {
    if (used.has(m.fixtureId)) continue;
    used.add(m.fixtureId);
    legs.push(m);
    const product = combinedPrice(legs);
    if (product != null && product >= target) break;
    if (legs.length >= 18) break;
  }
  const combined = combinedPrice(legs);
  legs.sort((a, b) => compareByMatchDay(a.kickoffUtc, b.kickoffUtc));
  const note =
    !legs.length
      ? 'Waiting on markets for today’s slip. Pull to refresh after fixtures load.'
      : combined != null && combined >= target
        ? `Daily 100-odds slip: ${legs.length} legs, combined analysed odds ${combined}. Confirm prices on Bet9ja/SportyBet. Not a guarantee.`
        : `Today’s slip: ${legs.length} legs, combined analysed odds ${combined ?? 'n/a'}. Confirm on site. Not a guarantee.`;
  return {
    target,
    legs,
    combinedAnalysedOdds: combined,
    note,
    bookSlips: formatBookmakerSlips(legs),
  };
}

export function buildAccumulators(markets: BookingCandidate[]) {
  const inLeague = (m: BookingCandidate) => isReliableLeague(m.league);
  const ranked = (rows: BookingCandidate[]) => [...rows].sort((a, b) => deliveryScore(b) - deliveryScore(a));
  const pool = (min: number, extra?: (m: BookingCandidate) => boolean) =>
    pickUnique(
      ranked(
        markets.filter(
          (m) =>
            inLeague(m) &&
            m.category !== 'AVOID' &&
            scoreOf(m) >= min &&
            extra?.(m) !== false,
        ),
      ),
      4,
    );
  const poolAny = (min: number, extra?: (m: BookingCandidate) => boolean) =>
    pickUnique(
      ranked(
        markets.filter((m) => inLeague(m) && scoreOf(m) >= min && extra?.(m) !== false),
      ),
      4,
    );
  let safe = pool(80);
  if (safe.length < 2) safe = pool(70);
  if (safe.length < 2) safe = poolAny(0);
  let balanced = pool(75);
  if (balanced.length < 2) balanced = pool(60);
  if (balanced.length < 2) balanced = poolAny(0);
  let high = pool(70, (m) => m.category === 'HIGH_ODDS' || (m.odds.bestOdds ?? 0) >= 2.2);
  if (high.length < 2) high = poolAny(0, (m) => (m.odds.bestOdds ?? analysedPrice(m) ?? 1) >= 1.4);
  const label = (legs: BookingCandidate[], min: number, name: string) =>
    legs.length < 2
      ? `${name}: building from today’s best available legs.`
      : `${name}: ${legs.length} legs, each ${min}+ / 100 when available. One match each. Not a guarantee.`;
  const byDay = (legs: BookingCandidate[]) =>
    [...legs].sort((a, b) => compareByMatchDay(a.kickoffUtc, b.kickoffUtc));
  return {
    safe: { minScore: 80, legs: byDay(safe), note: label(safe, 80, 'SAFE ACCUMULATOR') },
    balanced: { minScore: 75, legs: byDay(balanced), note: label(balanced, 75, 'BALANCED ACCUMULATOR') },
    highOdds: { minScore: 70, legs: byDay(high), note: label(high, 70, 'HIGH-ODDS ACCUMULATOR') },
  };
}

export function formatBookmakerSlips(legs: BookingCandidate[]): BookmakerSlip[] {
  const avgSafety =
    legs.length === 0
      ? 0
      : Math.round((legs.reduce((a, l) => a + l.safetyScore, 0) / legs.length) * 10) / 10;
  const avgDelivery =
    legs.length === 0
      ? 0
      : Math.round((legs.reduce((a, l) => a + l.deliveryRate, 0) / legs.length) * 10) / 10;

  return BOOKS.map((book) => ({
    id: book.id,
    label: book.label,
    site: book.site,
    how: book.how,
    bookingCode: null,
    avgSafety,
    avgDelivery,
    legs: legs.map((leg) => ({
      fixtureId: leg.fixtureId,
      match: `${leg.home} vs ${leg.away}`,
      pick: leg.label,
      safety: Math.round(scoreOf(leg)),
      country: leg.country,
      countryFlag: leg.countryFlag,
      league: leg.league,
      leagueHeading: leg.leagueHeading,
      cardLines: leg.cardLines,
    })),
    copyText: buildCopyText(book, legs, avgSafety),
  }));
}

function buildCopyText(
  book: (typeof BOOKS)[number],
  legs: BookingCandidate[],
  avgSafety: number,
): string {
  const header = [
    `${book.label.toUpperCase()} SLIP`,
    '',
    `Avg safe ${avgSafety}%`,
    'Confirm the pick on the site before you stake.',
    '',
  ];
  if (!legs.length) {
    return [...header, 'Waiting on markets — refresh Bet Bot after fixtures load.'].join('\n');
  }
  const body = legs.flatMap((leg, i) => [
    `${i + 1}.`,
    `${leg.home} vs ${leg.away}`,
    `Safe ${Math.round(scoreOf(leg))}%`,
    `Stake: ${leg.label}`,
    '',
  ]);
  return [...header, ...body].join('\n').trimEnd();
}
