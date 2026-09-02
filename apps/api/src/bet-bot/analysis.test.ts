import { describe, expect, it } from 'vitest';
import { analyzeFixture, categorize, cardMarketLines, diversifyRecommended, formScore, impliedProb, pickHighOddsMarket, orderPlayableMarkets } from './analysis';
import type { FixtureSummary, LineupInfo, TeamSnapshot } from './types';

const lineup: LineupInfo = {
  confirmed: false,
  homeXi: [],
  awayXi: [],
  missingHome: [],
  missingAway: [],
  rotationRisk: 'UNKNOWN',
  note: 'XI not confirmed',
};

const fixture: FixtureSummary = {
  id: '1',
  league: 'Premier League',
  competition: 'PL',
  kickoffUtc: '2026-08-26T15:00:00Z',
  status: 'TIMED',
  home: { id: 'h', name: 'Arsenal', popular: true },
  away: { id: 'a', name: 'Burnley', popular: false },
  popularMatch: true,
};

function team(over: Partial<TeamSnapshot> & Pick<TeamSnapshot, 'id' | 'name'>): TeamSnapshot {
  return {
    popular: false,
    last5: 'WWDWL',
    wins: 3,
    draws: 1,
    losses: 1,
    goalsFor: 8,
    goalsAgainst: 4,
    homeWins: 2,
    awayWins: 1,
    ...over,
  };
}

describe('bet analysis helpers', () => {
  it('scores form from W/D/L', () => {
    expect(formScore('WWWWW')).toBe(100);
    expect(formScore('LLLLL')).toBe(0);
  });

  it('does not treat long odds as automatically good', () => {
    const long = categorize({ safety: 48, edgePct: 1, odds: 9, avoid: false });
    expect(long.category).toBe('AVOID');
  });

  it('maps decimal odds to implied probability', () => {
    expect(impliedProb(2)).toBeCloseTo(0.5);
  });

  it('keeps popularity out of safety and never guarantees a pick', () => {
    const result = analyzeFixture({
      fixture,
      home: team({ id: 'h', name: 'Arsenal', popular: true, last5: 'WWWWW', goalsFor: 12, goalsAgainst: 2 }),
      away: team({ id: 'a', name: 'Burnley', popular: false, last5: 'LLLLL', goalsFor: 2, goalsAgainst: 10 }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(result.popularity.note.toLowerCase()).toContain('not added to the safety score');
    expect(result.disclaimer.toLowerCase()).toContain('not a guarantee');
    expect(result.markets.some((m) => m.market === 'OVER_2_5')).toBe(true);
    expect(result.teamStats.home.name).toBe('Arsenal');
    for (const m of result.markets) {
      expect(m.analysedOdds == null || m.analysedOdds > 1).toBe(true);
      expect(m.safetyScore).toBeGreaterThanOrEqual(0);
      expect(m.safetyScore).toBeLessThanOrEqual(100);
      expect(m.confidence).toBeLessThan(100);
      expect(m.reason.toLowerCase()).not.toContain('guaranteed');
      expect(m.reason.toLowerCase()).not.toContain('sure win');
    }
    if (result.recommended) {
      expect(result.recommended.category).not.toBe('AVOID');
      expect(result.noBet).toBe(false);
    }
  });

  it('builds card lines from this match’s strongest markets and skips multiscore', () => {
    const result = analyzeFixture({
      fixture,
      home: team({ id: 'h', name: 'Arsenal', popular: true, last5: 'WWWWW', goalsFor: 12, goalsAgainst: 2 }),
      away: team({ id: 'a', name: 'Burnley', popular: false, last5: 'LLLLL', goalsFor: 2, goalsAgainst: 10 }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    const lines = cardMarketLines(result);
    expect(lines[0]?.family).toBe('Safest');
    expect(lines[0]?.detail).toBeTruthy();
    expect(lines.some((l) => l.family === 'Multiscore')).toBe(false);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
    const extras = lines.slice(1);
    expect(extras.some((l) => l.family === 'Safest')).toBe(false);
    for (const line of lines) {
      expect(line.pct).toBeGreaterThan(0);
      expect(line.pct).toBeLessThanOrEqual(100);
      expect(line.detail.trim().length).toBeGreaterThan(0);
    }
  });

  it('always returns a pick even when scores are weak', () => {
    const result = analyzeFixture({
      fixture,
      home: team({
        id: 'h',
        name: 'Arsenal',
        popular: true,
        last5: 'LDLDL',
        last10: 'LDLDLDLDLD',
        wins: 1,
        draws: 4,
        losses: 5,
        goalsFor: 3,
        goalsAgainst: 8,
        sampleSize: 10,
        dataReliability: 'LIMITED',
      }),
      away: team({
        id: 'a',
        name: 'Burnley',
        popular: false,
        last5: 'DLDLD',
        last10: 'DLDLDLDLDL',
        wins: 1,
        draws: 4,
        losses: 5,
        goalsFor: 3,
        goalsAgainst: 8,
        sampleSize: 10,
        dataReliability: 'LIMITED',
      }),
      h2hText: 'UNKNOWN',
      importance: 'League match',
      lineup,
      injuriesHome: ['A', 'B', 'C'],
      injuriesAway: ['D'],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.category).not.toBe('AVOID');
    expect(result.noBet).toBe(false);
    expect(result.avoidReasons.join(' ').toLowerCase()).not.toContain('no bet');
    expect(result.markets.some((m) => m.market === result.recommended!.market && m.category !== 'AVOID')).toBe(
      true,
    );
    const weakLines = cardMarketLines(result);
    expect(weakLines[0]?.family).toBe('Safest');
    expect(weakLines.length).toBeGreaterThanOrEqual(3);
    expect(weakLines.some((l) => l.family === 'BTTS' && l.detail)).toBe(true);
    expect(weakLines.some((l) => /Over|Under/.test(l.family) && l.detail)).toBe(true);
  });

  it('can qualify a high-delivery market when form and sample agree', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      isHome: i % 2 === 0,
      gf: 2,
      ga: 1,
      opponent: i < 2 ? 'Burnley' : 'Other',
    }));
    const confirmed: LineupInfo = { ...lineup, confirmed: true, rotationRisk: 'LOW', homeXi: Array(11).fill('P'), awayXi: Array(11).fill('P') };
    const result = analyzeFixture({
      fixture,
      home: team({
        id: 'h',
        name: 'Arsenal',
        popular: true,
        last5: 'WWWWW',
        last10: 'WWWWWWWWWW',
        wins: 10,
        draws: 0,
        losses: 0,
        goalsFor: 22,
        goalsAgainst: 4,
        homeWins: 5,
        sampleSize: 10,
        dataReliability: 'GOOD',
        recent: rows,
        homeSplit: { played: 5, wins: 5, draws: 0, losses: 0, gf: 12, ga: 2, cleanSheets: 3, failedToScore: 0, over05: 5, over15: 5, over25: 4, over35: 1, over45: 0, btts: 3 },
      }),
      away: team({
        id: 'a',
        name: 'Burnley',
        popular: false,
        last5: 'LLLLL',
        last10: 'LLLLLLLLLL',
        wins: 0,
        draws: 0,
        losses: 10,
        goalsFor: 4,
        goalsAgainst: 22,
        awayWins: 0,
        sampleSize: 10,
        dataReliability: 'GOOD',
        recent: rows.map((r) => ({ ...r, gf: 0, ga: 2 })),
        awaySplit: { played: 5, wins: 0, draws: 0, losses: 5, gf: 2, ga: 12, cleanSheets: 0, failedToScore: 4, over05: 5, over15: 5, over25: 3, over35: 1, over45: 0, btts: 2 },
      }),
      h2hText: '2 recent H2H',
      importance: 'League match',
      lineup: confirmed,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(result.markets.some((m) => m.market === 'OVER_1_5')).toBe(true);
    const rec = result.recommended;
    expect(rec).not.toBeNull();
    expect(rec!.category).not.toBe('AVOID');
    expect(result.noBet).toBe(false);
  });

  it('picks over/btts from last-5 scoring, not a blanket Under 3.5', () => {
    const attack = [
      { isHome: true, gf: 3, ga: 1, opponent: 'A' },
      { isHome: false, gf: 2, ga: 1, opponent: 'B' },
      { isHome: true, gf: 4, ga: 2, opponent: 'C' },
      { isHome: false, gf: 2, ga: 2, opponent: 'D' },
      { isHome: true, gf: 3, ga: 1, opponent: 'E' },
    ];
    const result = analyzeFixture({
      fixture,
      home: team({
        id: 'h',
        name: 'Arsenal',
        last5: 'WWWDW',
        goalsFor: 14,
        goalsAgainst: 7,
        sampleSize: 5,
        recent: attack,
      }),
      away: team({
        id: 'a',
        name: 'Brighton',
        last5: 'WDWWW',
        goalsFor: 13,
        goalsAgainst: 8,
        sampleSize: 5,
        recent: attack.map((r) => ({ ...r, gf: r.gf - 0, ga: r.ga })),
      }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.market).not.toBe('UNDER_3_5');
    expect(result.recommended!.market).not.toBe('UNDER_4_5');
    expect(result.recommended!.market).not.toBe('OVER_0_5');
    expect(['OVER_2_5', 'OVER_1_5', 'OVER_3_5', 'BTTS_YES', 'HOME_OVER_1_5', 'AWAY_OVER_1_5', 'OVER_10_5_CORNERS']).toContain(
      result.recommended!.market,
    );
    expect(result.recommended!.reason.toLowerCase()).toMatch(/last (5|match)/);
  });

  it('does not pick under 2.5 when Real Madrid last match was over 2.5', () => {
    const result = analyzeFixture({
      fixture: { ...fixture, home: { id: 'h', name: 'Real Madrid', popular: true } },
      home: team({
        id: 'h',
        name: 'Real Madrid',
        last5: 'D',
        goalsFor: 2,
        goalsAgainst: 2,
        sampleSize: 1,
        recent: [{ isHome: true, gf: 2, ga: 2, opponent: 'Fiorentina' }],
      }),
      away: team({
        id: 'a',
        name: 'Osasuna',
        last5: 'WDLWD',
        goalsFor: 6,
        goalsAgainst: 5,
        sampleSize: 5,
        recent: [
          { isHome: false, gf: 1, ga: 1, opponent: 'A' },
          { isHome: true, gf: 2, ga: 0, opponent: 'B' },
          { isHome: false, gf: 0, ga: 2, opponent: 'C' },
          { isHome: true, gf: 2, ga: 1, opponent: 'D' },
          { isHome: false, gf: 1, ga: 1, opponent: 'E' },
        ],
      }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.market).not.toBe('UNDER_2_5');
    expect(result.recommended!.market).not.toBe('UNDER_3_5');
    expect(result.halfGoalPick?.market).not.toBe('UNDER_2_5');
  });

  it('picks home or 1X when home is consistently winning', () => {
    const homeWins = [
      { isHome: true, gf: 2, ga: 0, opponent: 'A' },
      { isHome: false, gf: 3, ga: 1, opponent: 'B' },
      { isHome: true, gf: 2, ga: 1, opponent: 'C' },
      { isHome: false, gf: 1, ga: 0, opponent: 'D' },
      { isHome: true, gf: 2, ga: 0, opponent: 'E' },
    ];
    const awayLosses = [
      { isHome: false, gf: 0, ga: 2, opponent: 'A' },
      { isHome: true, gf: 1, ga: 3, opponent: 'B' },
      { isHome: false, gf: 0, ga: 1, opponent: 'C' },
      { isHome: true, gf: 0, ga: 2, opponent: 'D' },
      { isHome: false, gf: 1, ga: 2, opponent: 'E' },
    ];
    const result = analyzeFixture({
      fixture,
      home: team({
        id: 'h',
        name: 'Arsenal',
        last5: 'WWWWW',
        wins: 5,
        draws: 0,
        losses: 0,
        goalsFor: 10,
        goalsAgainst: 2,
        sampleSize: 5,
        recent: homeWins,
      }),
      away: team({
        id: 'a',
        name: 'Burnley',
        last5: 'LLLLL',
        wins: 0,
        draws: 0,
        losses: 5,
        goalsFor: 2,
        goalsAgainst: 10,
        sampleSize: 5,
        recent: awayLosses,
      }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(['HOME', 'DC_1X', 'DNB_HOME', 'HOME_OVER_1_5']).toContain(
      result.recommended!.market,
    );
    expect(result.recommended!.market).not.toBe('OVER_2_5');
    expect(result.recommended!.market).not.toBe('UNDER_2_5');
    expect(result.multiScore?.side).toBe('HOME');
    expect(result.multiScore?.scores.map((s) => s.line)).toEqual(['2-0', '2-1', '3-0', '3-1']);
  });

  it('picks under 2.5 only when both last-5 records are actually low scoring', () => {
    const tight = [
      { isHome: true, gf: 1, ga: 0, opponent: 'A' },
      { isHome: false, gf: 0, ga: 0, opponent: 'B' },
      { isHome: true, gf: 1, ga: 1, opponent: 'C' },
      { isHome: false, gf: 0, ga: 1, opponent: 'D' },
      { isHome: true, gf: 1, ga: 0, opponent: 'E' },
    ];
    const result = analyzeFixture({
      fixture,
      home: team({
        id: 'h',
        name: 'Getafe',
        last5: 'WDWLD',
        goalsFor: 3,
        goalsAgainst: 2,
        sampleSize: 5,
        recent: tight,
      }),
      away: team({
        id: 'a',
        name: 'Cadiz',
        last5: 'DLWDL',
        goalsFor: 2,
        goalsAgainst: 3,
        sampleSize: 5,
        recent: tight.map((r) => ({ ...r, gf: r.ga, ga: r.gf })),
      }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(['UNDER_2_5', 'BTTS_NO', 'UNDER_10_5_CORNERS', 'DC_1X', 'HOME']).toContain(
      result.recommended!.market,
    );
    expect(result.recommended!.market).not.toBe('OVER_2_5');
  });

  it('uses different markets for win, tight, and both-score profiles', () => {
    const ctx = {
      fixture,
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [] as string[],
      injuriesAway: [] as string[],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    };
    const homeWins = analyzeFixture({
      ...ctx,
      home: team({
        id: 'h',
        name: 'Arsenal',
        last5: 'WWWWW',
        wins: 5,
        draws: 0,
        losses: 0,
        goalsFor: 10,
        goalsAgainst: 2,
        sampleSize: 5,
        recent: [
          { isHome: true, gf: 2, ga: 0, opponent: 'A' },
          { isHome: false, gf: 1, ga: 0, opponent: 'B' },
          { isHome: true, gf: 2, ga: 0, opponent: 'C' },
          { isHome: false, gf: 2, ga: 1, opponent: 'D' },
          { isHome: true, gf: 3, ga: 1, opponent: 'E' },
        ],
      }),
      away: team({
        id: 'a',
        name: 'Burnley',
        last5: 'LLLLL',
        wins: 0,
        draws: 0,
        losses: 5,
        goalsFor: 2,
        goalsAgainst: 10,
        sampleSize: 5,
        recent: [
          { isHome: false, gf: 0, ga: 2, opponent: 'A' },
          { isHome: true, gf: 1, ga: 2, opponent: 'B' },
          { isHome: false, gf: 0, ga: 1, opponent: 'C' },
          { isHome: true, gf: 0, ga: 2, opponent: 'D' },
          { isHome: false, gf: 1, ga: 3, opponent: 'E' },
        ],
      }),
    });
    const tight = analyzeFixture({
      ...ctx,
      home: team({
        id: 'h',
        name: 'Getafe',
        last5: 'WDWLD',
        goalsFor: 3,
        goalsAgainst: 2,
        sampleSize: 5,
        recent: [
          { isHome: true, gf: 1, ga: 0, opponent: 'A' },
          { isHome: false, gf: 0, ga: 0, opponent: 'B' },
          { isHome: true, gf: 1, ga: 1, opponent: 'C' },
          { isHome: false, gf: 0, ga: 1, opponent: 'D' },
          { isHome: true, gf: 1, ga: 0, opponent: 'E' },
        ],
      }),
      away: team({
        id: 'a',
        name: 'Cadiz',
        last5: 'DLWDL',
        goalsFor: 2,
        goalsAgainst: 3,
        sampleSize: 5,
        recent: [
          { isHome: false, gf: 0, ga: 1, opponent: 'A' },
          { isHome: true, gf: 0, ga: 0, opponent: 'B' },
          { isHome: false, gf: 1, ga: 1, opponent: 'C' },
          { isHome: true, gf: 1, ga: 0, opponent: 'D' },
          { isHome: false, gf: 0, ga: 1, opponent: 'E' },
        ],
      }),
    });
    const bothScore = analyzeFixture({
      ...ctx,
      home: team({
        id: 'h',
        name: 'Brentford',
        last5: 'WDWLD',
        goalsFor: 7,
        goalsAgainst: 6,
        sampleSize: 5,
        recent: [
          { isHome: true, gf: 1, ga: 1, opponent: 'A' },
          { isHome: false, gf: 2, ga: 1, opponent: 'B' },
          { isHome: true, gf: 1, ga: 2, opponent: 'C' },
          { isHome: false, gf: 2, ga: 2, opponent: 'D' },
          { isHome: true, gf: 1, ga: 0, opponent: 'E' },
        ],
      }),
      away: team({
        id: 'a',
        name: 'Brighton',
        last5: 'DWLWD',
        goalsFor: 7,
        goalsAgainst: 7,
        sampleSize: 5,
        recent: [
          { isHome: false, gf: 1, ga: 1, opponent: 'A' },
          { isHome: true, gf: 1, ga: 2, opponent: 'B' },
          { isHome: false, gf: 2, ga: 1, opponent: 'C' },
          { isHome: true, gf: 2, ga: 2, opponent: 'D' },
          { isHome: false, gf: 1, ga: 1, opponent: 'E' },
        ],
      }),
    });
    expect(['HOME', 'DC_1X', 'DNB_HOME', 'HOME_OVER_1_5']).toContain(homeWins.recommended!.market);
    expect(homeWins.recommended!.market).not.toBe('OVER_2_5');
    expect(['UNDER_2_5', 'BTTS_NO', 'UNDER_10_5_CORNERS']).toContain(tight.recommended!.market);
    expect(['BTTS_YES', 'OVER_2_5', 'HOME_OVER_1_5', 'DC_1X']).toContain(bothScore.recommended!.market);
    const homeSafest = homeWins.recommended!.market;
    const homeCard = cardMarketLines(homeWins)[0];
    const pack = diversifyRecommended([homeWins, tight, bothScore]);
    const markets = pack.map((a) => a.recommended!.market);
    expect(new Set(markets).size).toBe(3);
    expect(markets.filter((m) => m === 'OVER_2_5').length).toBeLessThanOrEqual(1);
    expect(homeWins.recommended!.market).toBe(homeSafest);
    expect(cardMarketLines(homeWins)[0]).toEqual(homeCard);
    expect(homeCard?.family).toBe('Safest');
  });

  it('finds a longer-priced high-odds market even when the safest pick is short', () => {
    const result = analyzeFixture({
      fixture,
      home: team({
        id: 'h',
        name: 'Arsenal',
        last5: 'WWWWW',
        wins: 5,
        draws: 0,
        losses: 0,
        goalsFor: 10,
        goalsAgainst: 2,
        sampleSize: 5,
        recent: [
          { isHome: true, gf: 2, ga: 0, opponent: 'A' },
          { isHome: false, gf: 1, ga: 0, opponent: 'B' },
          { isHome: true, gf: 2, ga: 0, opponent: 'C' },
          { isHome: false, gf: 2, ga: 1, opponent: 'D' },
          { isHome: true, gf: 3, ga: 1, opponent: 'E' },
        ],
      }),
      away: team({
        id: 'a',
        name: 'Burnley',
        last5: 'LLLLL',
        wins: 0,
        draws: 0,
        losses: 5,
        goalsFor: 2,
        goalsAgainst: 10,
        sampleSize: 5,
        recent: [
          { isHome: false, gf: 0, ga: 2, opponent: 'A' },
          { isHome: true, gf: 1, ga: 2, opponent: 'B' },
          { isHome: false, gf: 0, ga: 1, opponent: 'C' },
          { isHome: true, gf: 0, ga: 2, opponent: 'D' },
          { isHome: false, gf: 1, ga: 3, opponent: 'E' },
        ],
      }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    const high = pickHighOddsMarket(result.markets);
    expect(high).not.toBeNull();
    expect(high!.analysedOdds ?? 0).toBeGreaterThanOrEqual(1.9);
    expect(high!.market).not.toBe('OVER_0_5');
  });

  it('uses away multiscore 0-2, 1-2, 0-3, 1-3 when the away side is dominating', () => {
    const result = analyzeFixture({
      fixture: { ...fixture, home: { id: 'h', name: 'Burnley', popular: false }, away: { id: 'a', name: 'Arsenal', popular: true } },
      home: team({
        id: 'h',
        name: 'Burnley',
        last5: 'LLLLL',
        wins: 0,
        draws: 0,
        losses: 5,
        goalsFor: 2,
        goalsAgainst: 10,
        sampleSize: 5,
        recent: [
          { isHome: true, gf: 0, ga: 2, opponent: 'A' },
          { isHome: false, gf: 1, ga: 2, opponent: 'B' },
          { isHome: true, gf: 0, ga: 1, opponent: 'C' },
          { isHome: false, gf: 0, ga: 2, opponent: 'D' },
          { isHome: true, gf: 1, ga: 3, opponent: 'E' },
        ],
      }),
      away: team({
        id: 'a',
        name: 'Arsenal',
        last5: 'WWWWW',
        wins: 5,
        draws: 0,
        losses: 0,
        goalsFor: 10,
        goalsAgainst: 2,
        sampleSize: 5,
        recent: [
          { isHome: false, gf: 2, ga: 0, opponent: 'A' },
          { isHome: true, gf: 1, ga: 0, opponent: 'B' },
          { isHome: false, gf: 2, ga: 0, opponent: 'C' },
          { isHome: true, gf: 2, ga: 1, opponent: 'D' },
          { isHome: false, gf: 3, ga: 1, opponent: 'E' },
        ],
      }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(result.multiScore?.side).toBe('AWAY');
    expect(result.multiScore?.scores.map((s) => s.line)).toEqual(['0-2', '1-2', '0-3', '1-3']);
  });

  it('keeps the Safest card line on recommended even when BTTS has a higher raw score', () => {
    const result = analyzeFixture({
      fixture: { ...fixture, home: { id: 'h', name: 'Bournemouth', popular: false }, away: { id: 'a', name: 'Everton', popular: true } },
      home: team({
        id: 'h',
        name: 'Bournemouth',
        last5: 'WDLWW',
        wins: 3,
        draws: 1,
        losses: 1,
        goalsFor: 7,
        goalsAgainst: 6,
        sampleSize: 5,
        recent: [
          { isHome: true, gf: 2, ga: 1, opponent: 'A' },
          { isHome: false, gf: 1, ga: 1, opponent: 'B' },
          { isHome: true, gf: 0, ga: 2, opponent: 'C' },
          { isHome: false, gf: 2, ga: 0, opponent: 'D' },
          { isHome: true, gf: 2, ga: 2, opponent: 'E' },
        ],
      }),
      away: team({
        id: 'a',
        name: 'Everton',
        last5: 'WWWLW',
        wins: 4,
        draws: 0,
        losses: 1,
        goalsFor: 11,
        goalsAgainst: 4,
        sampleSize: 5,
        recent: [
          { isHome: false, gf: 3, ga: 1, opponent: 'A' },
          { isHome: true, gf: 2, ga: 0, opponent: 'B' },
          { isHome: false, gf: 2, ga: 1, opponent: 'C' },
          { isHome: true, gf: 1, ga: 2, opponent: 'D' },
          { isHome: false, gf: 3, ga: 0, opponent: 'E' },
        ],
      }),
      h2hText: 'Limited H2H sample',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official Bet9ja/SportyBet odds feed',
    });
    expect(result.recommended).not.toBeNull();
    const rec = result.recommended!;
    const btts = result.markets.find((m) => m.market === 'BTTS_YES');
    const lines = cardMarketLines(result);
    expect(lines[0]?.family).toBe('Safest');
    expect(lines[0]?.detail.toLowerCase()).toContain(
      rec.market === 'BTTS_YES' ? 'btts' : rec.label.replace(/\s+goals$/i, '').toLowerCase().slice(0, 8),
    );
    if (btts && rec.market !== 'BTTS_YES' && (btts.analysisScore ?? 0) > (rec.analysisScore ?? 0)) {
      expect(lines[0]?.detail.toLowerCase()).not.toContain('btts');
    }
    const ordered = orderPlayableMarkets(result.markets, rec, result.rankedMarkets);
    expect(ordered[0]?.market).toBe(rec.market);
  });

  it('lists recommended first even if another market has a higher analysis score', () => {
    const ordered = orderPlayableMarkets(
      [
        { market: 'BTTS_YES', category: 'BEST_VALUE', analysisScore: 72, safetyScore: 72 },
        { market: 'AWAY_OVER_1_5', category: 'SAFEST', analysisScore: 56, safetyScore: 56 },
        { market: 'OVER_2_5', category: 'BEST_VALUE', analysisScore: 61, safetyScore: 61 },
      ],
      { market: 'AWAY_OVER_1_5' },
      ['AWAY_OVER_1_5', 'OVER_2_5', 'BTTS_YES'],
    );
    expect(ordered.map((m) => m.market)).toEqual(['AWAY_OVER_1_5', 'OVER_2_5', 'BTTS_YES']);
  });
});
