import { describe, expect, it } from 'vitest';
import { attachLiveToTwin, dedupeEvents, eventMatchKey, isLiveStatus, namesClose } from './football.provider';
import { isPopularTeam, isReliableLeague } from './popular';

describe('fixture merge', () => {
  it('keeps one row per match and prefers live scores', () => {
    const rows = dedupeEvents([
      {
        id: 'tsdb_1',
        league: 'Premier League',
        kickoffUtc: '2026-08-26T15:00:00Z',
        homeId: 'a',
        homeName: 'Arsenal',
        awayId: 'b',
        awayName: 'Burnley',
        status: 'TIMED',
      },
      {
        id: 'fd_99',
        league: 'Premier League',
        kickoffUtc: '2026-08-26T15:00:00Z',
        homeId: 'fd_1',
        homeName: 'Arsenal',
        awayId: 'fd_2',
        awayName: 'Burnley',
        status: 'IN_PLAY',
        live: true,
        homeScore: 1,
        awayScore: 0,
        minute: '67',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('fd_99');
    expect(rows[0]?.live).toBe(true);
    expect(rows[0]?.homeScore).toBe(1);
  });

  it('treats AFC Bournemouth and Bournemouth as the same match', () => {
    const rows = dedupeEvents([
      {
        id: 'tsdb_1',
        league: 'Premier League',
        kickoffUtc: '2026-08-29T14:00:00Z',
        homeId: 'a',
        homeName: 'AFC Bournemouth',
        awayId: 'b',
        awayName: 'Everton',
        status: 'TIMED',
      },
      {
        id: 'fd_9',
        league: 'Premier League',
        kickoffUtc: '2026-08-29T14:00:00Z',
        homeId: 'fd_a',
        homeName: 'Bournemouth',
        awayId: 'fd_b',
        awayName: 'Everton',
        status: 'TIMED',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(eventMatchKey('AFC Bournemouth', 'Everton', '2026-08-29T14:00:00Z')).toBe(
      eventMatchKey('Bournemouth', 'Everton', '2026-08-29T14:00:00Z'),
    );
  });

  it('removes duplicate source rows that reuse one provider event id', () => {
    const rows = dedupeEvents([
      {
        id: 'fotmob_1',
        league: 'Premier League',
        kickoffUtc: '2026-08-30T13:00:00Z',
        homeId: 'h',
        homeName: 'Leeds',
        awayId: 'a',
        awayName: 'Brentford',
        status: 'TIMED',
      },
      {
        id: 'fotmob_1',
        league: 'Premier League',
        kickoffUtc: '2026-08-30T13:00:00Z',
        homeId: 'h',
        homeName: 'Leeds United',
        awayId: 'a',
        awayName: 'Brentford',
        status: 'TIMED',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.homeName).toBe('Leeds United');
  });

  it('reattaches a live score to the scheduled fixture id', () => {
    const live = {
      id: 'odds_abc',
      league: 'Premier League',
      kickoffUtc: '2026-08-26T15:00:00Z',
      homeId: 'Arsenal',
      homeName: 'Arsenal',
      awayId: 'Burnley',
      awayName: 'Burnley',
      status: 'LIVE',
      live: true,
      homeScore: 2,
      awayScore: 0,
      minute: '55',
    };
    const twin = attachLiveToTwin(live, [
      {
        id: 'tsdb_1',
        league: 'Premier League',
        kickoffUtc: '2026-08-26T15:00:00Z',
        homeId: 'tsdb_a',
        homeName: 'Arsenal',
        awayId: 'tsdb_b',
        awayName: 'Burnley',
        status: 'TIMED',
      },
    ]);
    expect(twin.id).toBe('tsdb_1');
    expect(twin.live).toBe(true);
    expect(twin.homeScore).toBe(2);
  });

  it('treats in-play statuses as live', () => {
    expect(isLiveStatus('IN_PLAY')).toBe(true);
    expect(isLiveStatus('1H')).toBe(true);
    expect(isLiveStatus('TIMED')).toBe(false);
  });

  it('does not treat Manchester United and Manchester City as the same club', () => {
    expect(namesClose('Manchester United', 'Man Utd')).toBe(true);
    expect(namesClose('Bayern Munich', 'Bayern München')).toBe(true);
    expect(namesClose('Manchester United', 'Manchester City')).toBe(false);
    expect(namesClose('Manchester United', 'Bayern Munich')).toBe(false);
  });
});

describe('league and popularity filters', () => {
  it('keeps EFL Cup and Bundesliga names', () => {
    expect(isReliableLeague('EFL Cup')).toBe(true);
    expect(isReliableLeague('1. Fußball-Bundesliga 2026/2027')).toBe(true);
    expect(isReliableLeague('American USL Championship')).toBe(false);
  });

  it('matches Bayern with umlauts', () => {
    expect(isPopularTeam('FC Bayern München')).toBe(true);
  });

  it('treats Premier League as a top league and Championship as not', () => {
    expect(isReliableLeague('Premier League')).toBe(true);
    expect(isReliableLeague('English Championship')).toBe(false);
    expect(isReliableLeague('Eredivisie')).toBe(true);
    expect(isReliableLeague('Primeira Liga')).toBe(true);
    expect(isReliableLeague('Süper Lig')).toBe(true);
  });
});
