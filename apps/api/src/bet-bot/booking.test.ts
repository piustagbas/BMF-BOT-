import { describe, expect, it } from 'vitest';
import { diverseFixtures, selectBookingLegs, type BookingCandidate } from './booking';
import type { FixtureSummary } from './types';

function fx(id: string, league: string, home: string, kickoffUtc = '2026-08-26T15:00:00Z'): FixtureSummary {
  return {
    id,
    league,
    competition: league,
    kickoffUtc,
    status: 'TIMED',
    home: { id: home, name: home, popular: true },
    away: { id: 'a', name: 'Away', popular: false },
    popularMatch: true,
  };
}

function cand(over: Partial<BookingCandidate> & Pick<BookingCandidate, 'fixtureId' | 'league' | 'market'>): BookingCandidate {
  return {
    home: 'Home',
    away: 'Away',
    match: 'Home vs Away',
    kickoffUtc: '2026-08-26T15:00:00Z',
    popularMatch: true,
    deliveryRate: 70,
    label: over.market,
    modelProbability: 70,
    safetyScore: 70,
    category: 'SAFEST',
    riskLevel: 'Low Risk',
    reason: 'test',
    odds: { bestOdds: null },
    ...over,
  };
}

describe('booking selection', () => {
  it('spreads analysis fixtures across leagues', () => {
    const items = [
      fx('1', 'Premier League', 'Arsenal'),
      fx('2', 'Premier League', 'Liverpool'),
      fx('3', 'La Liga', 'Barcelona'),
      fx('4', 'Serie A', 'Inter'),
    ];
    const mix = diverseFixtures(items, 3).map((f) => f.id);
    expect(mix).toEqual(['1', '3', '4']);
  });

  it('fills today fixtures before tomorrow', () => {
    const now = new Date(2026, 7, 26, 18, 0, 0);
    const items = [
      fx('tmr-pl', 'Premier League', 'Arsenal', new Date(2026, 7, 27, 15, 0, 0).toISOString()),
      fx('today-es', 'La Liga', 'Barcelona', new Date(2026, 7, 26, 19, 0, 0).toISOString()),
      fx('tmr-it', 'Serie A', 'Inter', new Date(2026, 7, 27, 19, 0, 0).toISOString()),
      fx('today-pl', 'Premier League', 'Liverpool', new Date(2026, 7, 26, 15, 0, 0).toISOString()),
    ];
    const mix = diverseFixtures(items, 3, now).map((f) => f.id);
    expect(mix[0]).toMatch(/^today-/);
    expect(mix.filter((id) => id.startsWith('today-')).length).toBe(2);
    expect(mix[2]).toMatch(/^tmr-/);
  });

  it('keeps one market per match and mixes leagues by delivery rate', () => {
    const legs = selectBookingLegs([
      cand({ fixtureId: 'epl1', league: 'Premier League', market: 'OVER_2_5', deliveryRate: 90, modelProbability: 90 }),
      cand({ fixtureId: 'epl1', league: 'Premier League', market: 'OVER_1_5', deliveryRate: 80, modelProbability: 80 }),
      cand({ fixtureId: 'epl2', league: 'Premier League', market: 'DC_1X', deliveryRate: 88, modelProbability: 88 }),
      cand({ fixtureId: 'es1', league: 'La Liga', market: 'BTTS_YES', deliveryRate: 75, modelProbability: 75 }),
      cand({ fixtureId: 'it1', league: 'Serie A', market: 'HOME', deliveryRate: 72, modelProbability: 72 }),
    ], 3);
    expect(legs.legs).toHaveLength(3);
    expect(new Set(legs.legs.map((l) => l.fixtureId)).size).toBe(3);
    expect(legs.legs.map((l) => l.fixtureId).sort()).toEqual(['epl1', 'es1', 'it1']);
    expect(legs.legs.find((l) => l.fixtureId === 'epl1')?.market).toBe('OVER_2_5');
  });

  it('drops non-top leagues and avoid markets', () => {
    const legs = selectBookingLegs([
      cand({ fixtureId: 'ch', league: 'Championship', market: 'OVER_1_5', deliveryRate: 99, modelProbability: 99 }),
      cand({ fixtureId: 'pl', league: 'Premier League', market: 'DRAW', deliveryRate: 90, modelProbability: 90, category: 'SAFEST' }),
      cand({ fixtureId: 'pl2', league: 'Premier League', market: 'OVER_1_5', deliveryRate: 70, modelProbability: 70 }),
    ]);
    expect(legs.legs.map((l) => l.fixtureId)).toEqual(['pl2']);
  });

  it('still builds a slip when high-delivery markets are flagged avoid', () => {
    const legs = selectBookingLegs([
      cand({
        fixtureId: 'pl',
        league: 'Premier League',
        market: 'OVER_1_5',
        deliveryRate: 78,
        modelProbability: 78,
        category: 'AVOID',
        safetyScore: 58,
      }),
      cand({
        fixtureId: 'es',
        league: 'La Liga',
        market: 'DC_1X',
        deliveryRate: 74,
        modelProbability: 74,
        category: 'AVOID',
        safetyScore: 57,
      }),
    ]);
    expect(legs.legs.map((l) => l.fixtureId).sort()).toEqual(['es', 'pl']);
    expect(legs.bookSlips).toHaveLength(3);
    expect(legs.bookSlips[0]?.label).toBe('Bet9ja');
    expect(legs.bookSlips[0]?.copyText).toContain('BET9JA SLIP');
    expect(legs.bookSlips[0]?.copyText).toContain('Stake:');
    expect(legs.bookSlips[0]?.copyText).toContain('Safe');
    expect(legs.bookSlips[0]?.bookingCode).toBeNull();
    expect(legs.bookSlips[1]?.copyText).toContain('SPORTYBET SLIP');
  });

  it('builds accumulators only from qualifying scores', () => {
    const { accumulators } = selectBookingLegs([
      cand({ fixtureId: 'epl1', league: 'Premier League', market: 'OVER_1_5', analysisScore: 84, safetyScore: 84, deliveryRate: 88 }),
      cand({ fixtureId: 'es1', league: 'La Liga', market: 'DC_1X', analysisScore: 81, safetyScore: 81, deliveryRate: 80 }),
      cand({ fixtureId: 'it1', league: 'Serie A', market: 'OVER_0_5', analysisScore: 76, safetyScore: 76, deliveryRate: 90 }),
      cand({ fixtureId: 'de1', league: 'Bundesliga', market: 'UNDER_3_5', analysisScore: 71, safetyScore: 71, deliveryRate: 70, category: 'HIGH_ODDS', odds: { bestOdds: 2.4 } }),
      cand({ fixtureId: 'fr1', league: 'Ligue 1', market: 'DC_12', analysisScore: 72, safetyScore: 72, deliveryRate: 68, category: 'HIGH_ODDS', odds: { bestOdds: 2.5 } }),
    ]);
    expect(accumulators.safe.legs).toHaveLength(2);
    expect(accumulators.safe.note).toContain('SAFE ACCUMULATOR');
    expect(accumulators.balanced.legs.length).toBeGreaterThanOrEqual(2);
    expect(accumulators.highOdds.note).not.toBe('NO QUALIFYING ACCUMULATOR.');
  });

  it('builds a daily 100-odds slip from high-delivery analysed prices', () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      cand({
        fixtureId: `m${i}`,
        league: i % 2 ? 'La Liga' : 'Premier League',
        market: 'OVER_1_5',
        analysisScore: 82,
        safetyScore: 82,
        deliveryRate: 88,
        modelProbability: 80,
        analysedOdds: 1.28,
      }),
    );
    const daily = selectBookingLegs(many).daily100;
    expect(daily.legs.length).toBeGreaterThan(1);
    expect(daily.combinedAnalysedOdds).toBeGreaterThan(1);
    expect(daily.note.toLowerCase()).not.toContain('guaranteed');
  });

  it('still builds an accumulator from the best available legs', () => {
    const { accumulators } = selectBookingLegs([
      cand({ fixtureId: 'pl', league: 'Premier League', market: 'OVER_1_5', analysisScore: 72, safetyScore: 72 }),
    ]);
    expect(accumulators.safe.note.toLowerCase()).not.toContain('no bet');
    expect(accumulators.safe.note).not.toBe('NO QUALIFYING ACCUMULATOR.');
  });

  it('puts spaced safe % and pick on the copy-paste slip', () => {
    const { bookSlips } = selectBookingLegs([
      cand({
        fixtureId: 'pl',
        league: 'Premier League',
        market: 'HOME',
        label: 'Home',
        deliveryRate: 82,
        modelProbability: 82,
        safetyScore: 82,
        country: 'England',
      }),
    ]);
    const copy = bookSlips[0]?.copyText ?? '';
    expect(copy).toContain('Home vs Away');
    expect(copy).toMatch(/Safe 82%/);
    expect(copy).toContain('Stake: Home');
    expect(copy).not.toContain('last 5');
    expect(bookSlips[0]?.legs?.[0]).toMatchObject({ pick: 'Home', safety: 82 });
  });
});
