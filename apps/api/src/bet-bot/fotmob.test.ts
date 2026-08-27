import { describe, expect, it } from 'vitest';
import {
  indexFotmobDirectory,
  lookupFotmobId,
  mergeFotmobRows,
  rowsFromFotmobFixtures,
  rowsFromFotmobForm,
  teamsFromLeaguePayload,
} from './fotmob';

describe('fotmob form parsing', () => {
  it('reads team ids from a league table payload', () => {
    const payload = {
      table: [{ data: { table: { all: [{ id: 9825, name: 'Arsenal', shortName: 'ARS', played: 2 }] } } }],
    };
    expect(teamsFromLeaguePayload(payload)).toEqual([{ id: '9825', name: 'Arsenal', shortName: 'ARS' }]);
  });

  it('looks up Man City against Manchester City', () => {
    const dir = indexFotmobDirectory([{ id: '8456', name: 'Manchester City', shortName: 'Man City' }]);
    expect(lookupFotmobId('Man City', dir)).toBe('8456');
    expect(lookupFotmobId('Manchester City', dir)).toBe('8456');
  });

  it('builds last results newest first from finished fixtures', () => {
    const rows = rowsFromFotmobFixtures('9825', [
      {
        home: { id: 9825, name: 'Arsenal', score: 3 },
        away: { id: 8669, name: 'Coventry', score: 0 },
        status: { utcTime: '2026-08-21T19:00:00.000Z', finished: true },
      },
      {
        home: { id: 9825, name: 'Arsenal', score: null },
        away: { id: 1, name: 'Future', score: null },
        status: { utcTime: '2026-08-30T15:00:00.000Z', finished: false },
      },
      {
        home: { id: 8456, name: 'Man City', score: 0 },
        away: { id: 9825, name: 'Arsenal', score: 3 },
        status: { utcTime: '2026-08-16T15:00:00.000Z', finished: true },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ isHome: true, gf: 3, ga: 0, opponent: 'Coventry' });
    expect(rows[1]).toMatchObject({ isHome: false, gf: 3, ga: 0, opponent: 'Man City' });
  });

  it('fills gaps from teamForm tooltips', () => {
    const rows = rowsFromFotmobForm('8633', [
      {
        resultString: 'W',
        tooltipText: {
          homeTeam: 'Espanyol',
          homeTeamId: 99,
          homeScore: 1,
          awayTeam: 'Real Madrid',
          awayTeamId: 8633,
          awayScore: 2,
          utcTime: '2026-08-22T19:00:00.000Z',
        },
      },
    ]);
    expect(rows[0]).toMatchObject({ isHome: false, gf: 2, ga: 1, opponent: 'Espanyol' });
  });

  it('merges without inventing extra games', () => {
    const a = [{ isHome: true, gf: 2, ga: 2, opponent: 'Fiorentina', playedAt: '2026-08-01' }];
    const b = [{ isHome: true, gf: 2, ga: 2, opponent: 'Fiorentina', playedAt: '2026-08-01' }];
    expect(mergeFotmobRows(a, b)).toHaveLength(1);
  });
});
