import { describe, expect, it } from 'vitest';
import { analyzeFixture } from './analysis';
import { aiPickAllowed, localAnalyst, parseAiJson, parseAiMarket } from './aiAnalyst';
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
  home: { id: 'h', name: 'Real Madrid', popular: true },
  away: { id: 'a', name: 'Osasuna', popular: false },
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

describe('AI analyst before pick', () => {
  it('maps ChatGPT market names onto playable codes', () => {
    expect(parseAiMarket('OVER_2_5')).toBe('OVER_2_5');
    expect(parseAiMarket('Over 2.5 goals')).toBe('OVER_2_5');
    expect(parseAiMarket('Double chance 1X')).toBe('DC_1X');
    expect(parseAiMarket('UNDER_0_5')).toBeNull();
  });

  it('parses JSON even when wrapped in markdown', () => {
    const parsed = parseAiJson(
      '```json\n{"market":"HOME","homeRead":"Madrid in form","awayRead":"Osasuna mixed","summary":"Home lean","lean":"home control","why":["last 5 wins"],"risk":"rotation"}\n```',
    );
    expect(parsed?.market).toBe('HOME');
    expect(parsed?.homeRead).toContain('Madrid');
  });

  it('blocks under 2.5 when the last match was over 2.5', () => {
    const home = team({
      id: 'h',
      name: 'Real Madrid',
      recent: [{ isHome: true, gf: 2, ga: 2, opponent: 'Fiorentina' }],
      sampleSize: 1,
      goalsFor: 2,
      goalsAgainst: 2,
    });
    const away = team({
      id: 'a',
      name: 'Osasuna',
      recent: [{ isHome: false, gf: 1, ga: 2, opponent: 'Barca' }],
      sampleSize: 1,
      goalsFor: 1,
      goalsAgainst: 2,
    });
    expect(aiPickAllowed('UNDER_2_5', home, away)).toBe(false);
    expect(aiPickAllowed('OVER_2_5', home, away)).toBe(true);
  });

  it('writes a two-team read before the bet, even without ChatGPT', () => {
    const home = team({
      id: 'h',
      name: 'Real Madrid',
      last5: 'D',
      recent: [{ isHome: true, gf: 2, ga: 2, opponent: 'Fiorentina' }],
      sampleSize: 1,
      goalsFor: 2,
      goalsAgainst: 2,
    });
    const away = team({
      id: 'a',
      name: 'Osasuna',
      last5: 'WDLWD',
      recent: [
        { isHome: false, gf: 1, ga: 1, opponent: 'A' },
        { isHome: true, gf: 2, ga: 0, opponent: 'B' },
        { isHome: false, gf: 0, ga: 2, opponent: 'C' },
        { isHome: true, gf: 2, ga: 1, opponent: 'D' },
        { isHome: false, gf: 1, ga: 1, opponent: 'E' },
      ],
      sampleSize: 5,
    });
    const analysis = analyzeFixture({
      fixture,
      home,
      away,
      h2hText: 'Limited H2H',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official odds',
    });
    const ai = localAnalyst(analysis, home, away);
    expect(ai.homeRead.toLowerCase()).toContain('real madrid');
    expect(ai.homeRead.toLowerCase()).toContain('over 2.5');
    expect(ai.awayRead.toLowerCase()).toContain('osasuna');
    expect(ai.summary.toLowerCase()).toContain('pick is chosen after this read');
    expect(ai.market).not.toBe('UNDER_2_5');
  });
});
