import { describe, expect, it } from 'vitest';
import { analyzeFixture } from './analysis';
import {
  aiPickAllowed,
  aiReadMatchesFixture,
  localAnalyst,
  parseAiJson,
  parseAiMarket,
  parseResponsesOutput,
  pickBetterMarket,
} from './aiAnalyst';
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

  it('extracts Responses API text and web-search citations', () => {
    const result = parseResponsesOutput({
      output: [
        {
          type: 'web_search_call',
          action: {
            sources: [{ title: 'Forebet', url: 'https://www.forebet.com/match' }],
          },
        },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '{"market":"HOME","homeRead":"Real Madrid form","awayRead":"Osasuna form","summary":"Real Madrid vs Osasuna","lean":"home control","why":[],"risk":"rotation"}',
              annotations: [
                { type: 'url_citation', title: 'PredictZ', url: 'https://www.predictz.com/match' },
              ],
            },
          ],
        },
      ],
    });
    expect(result.text).toContain('"market":"HOME"');
    expect(result.sources).toEqual([
      { title: 'Forebet', url: 'https://www.forebet.com/match' },
      { title: 'PredictZ', url: 'https://www.predictz.com/match' },
    ]);
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

  it('keeps the stronger of stats vs ChatGPT and does not mix clubs', () => {
    const home = team({
      id: 'h',
      name: 'Manchester United',
      recent: [
        { isHome: true, gf: 2, ga: 1, opponent: 'Fulham' },
        { isHome: false, gf: 1, ga: 0, opponent: 'Burnley' },
      ],
      sampleSize: 2,
      goalsFor: 3,
      goalsAgainst: 1,
    });
    const away = team({
      id: 'a',
      name: 'Bayern Munich',
      recent: [
        { isHome: true, gf: 3, ga: 1, opponent: 'Leverkusen' },
        { isHome: false, gf: 2, ga: 2, opponent: 'Leipzig' },
      ],
      sampleSize: 2,
      goalsFor: 5,
      goalsAgainst: 3,
    });
    const analysis = analyzeFixture({
      fixture: {
        ...fixture,
        league: 'UEFA Champions League',
        home: { id: 'h', name: 'Manchester United', popular: true },
        away: { id: 'a', name: 'Bayern Munich', popular: true },
      },
      home,
      away,
      h2hText: 'Limited H2H',
      importance: 'High — cup/european fixture (rotation risk possible)',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official odds',
    });
    const rec = analysis.recommended!.market;
    const same = pickBetterMarket(analysis, rec, rec, home, away);
    expect(same.from).toBe('stats');
    expect(same.market).toBe(rec);
    const blocked = pickBetterMarket(analysis, rec, 'UNDER_2_5', home, away);
    expect(blocked.market).toBe(rec);
    const read = localAnalyst(analysis, home, away);
    expect(read.homeRead.toLowerCase()).toContain('manchester united');
    expect(read.awayRead.toLowerCase()).toContain('bayern');
    expect(read.homeRead.toLowerCase()).not.toContain('bayern');
  });

  it('rejects an AI response that names the wrong fixture', () => {
    const analysis = analyzeFixture({
      fixture,
      home: team({ id: 'h', name: 'Real Madrid' }),
      away: team({ id: 'a', name: 'Osasuna' }),
      h2hText: 'Limited H2H',
      importance: 'League match',
      lineup,
      injuriesHome: [],
      injuriesAway: [],
      oddsNote: 'No official odds',
    });
    const parsed = parseAiJson(
      '{"market":"HOME","homeRead":"Manchester United are in form","awayRead":"Bayern Munich are strong","summary":"Manchester United should beat Bayern Munich","lean":"home control","why":[],"risk":"rotation"}',
    )!;
    expect(aiReadMatchesFixture(parsed, analysis)).toBe(false);
  });
});
