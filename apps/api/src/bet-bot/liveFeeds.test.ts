import { describe, expect, it } from 'vitest';
import {
  eventsFromFotmobMatches,
  eventsFromLivescoreApp,
  eventsFromSofascoreLive,
  looksLikeHtmlOrAds,
} from './liveFeeds';

describe('ad/html blocking', () => {
  it('rejects HTML pages and ad networks', () => {
    expect(looksLikeHtmlOrAds('<!doctype html><html><ins class="adsbygoogle">', 'text/html')).toBe(true);
    expect(looksLikeHtmlOrAds('{"events":[]}', 'application/json')).toBe(false);
    expect(looksLikeHtmlOrAds('<html><script src="https://pagead2.googlesyndication.com/x"></script>')).toBe(true);
  });
});

describe('live feed parsers', () => {
  it('reads in-play FotMob matches and skips finished ones', () => {
    const rows = eventsFromFotmobMatches({
      leagues: [
        {
          name: 'Bundesliga',
          ccode: 'GER',
          matches: [
            {
              id: 1,
              home: { id: 10, name: 'Bayern', score: 2 },
              away: { id: 20, name: 'Union Berlin', score: 0 },
              status: {
                utcTime: '2026-08-29T14:00:00.000Z',
                started: true,
                finished: false,
                liveTime: { short: "67'" },
              },
            },
            {
              id: 2,
              home: { id: 11, name: 'Dortmund', score: 1 },
              away: { id: 21, name: 'Leipzig', score: 1 },
              status: { utcTime: '2026-08-29T12:00:00.000Z', started: true, finished: true },
            },
          ],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      homeName: 'Bayern',
      awayName: 'Union Berlin',
      live: true,
      homeScore: 2,
      awayScore: 0,
      league: 'Bundesliga',
    });
  });

  it('reads scheduled FotMob matches when asked', () => {
    const rows = eventsFromFotmobMatches(
      {
        leagues: [
          {
            name: 'Eredivisie',
            ccode: 'NED',
            matches: [
              {
                id: 9,
                home: { id: 1, name: 'Ajax' },
                away: { id: 2, name: 'PSV' },
                status: { utcTime: '2026-08-30T14:00:00.000Z', started: false, finished: false },
              },
            ],
          },
        ],
      },
      { includeScheduled: true },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ homeName: 'Ajax', awayName: 'PSV', live: false, league: 'Eredivisie' });
  });

  it('reads SofaScore in-progress events only', () => {
    const rows = eventsFromSofascoreLive({
      events: [
        {
          id: 9,
          startTimestamp: 1756472400,
          status: { type: 'inprogress', description: '2nd half' },
          homeTeam: { id: 1, name: 'Arsenal' },
          awayTeam: { id: 2, name: 'Burnley' },
          homeScore: { current: 1 },
          awayScore: { current: 0 },
          tournament: { name: 'Premier League', category: { name: 'England' } },
        },
        {
          id: 10,
          status: { type: 'finished' },
          homeTeam: { name: 'Done' },
          awayTeam: { name: 'Over' },
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.homeName).toBe('Arsenal');
    expect(rows[0]?.homeScore).toBe(1);
  });

  it('reads Livescore.com app JSON without HTML', () => {
    const rows = eventsFromLivescoreApp({
      Stages: [
        {
          Snm: 'LaLiga',
          Cnm: 'Spain',
          Events: [
            {
              Eid: '55',
              Eps: '12',
              Esd: 20260829150000,
              Tr1: '0',
              Tr2: '1',
              T1: [{ Nm: 'Valencia', ID: 1 }],
              T2: [{ Nm: 'Sevilla', ID: 2 }],
            },
            {
              Eid: '56',
              Eps: 'FT',
              T1: [{ Nm: 'Old' }],
              T2: [{ Nm: 'Done' }],
            },
          ],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ homeName: 'Valencia', awayName: 'Sevilla', homeScore: 0, awayScore: 1 });
  });
});
