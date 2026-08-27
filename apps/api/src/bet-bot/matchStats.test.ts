import { describe, expect, it } from 'vitest';
import { last5Profile, sampleDelivery, snapshotFromRows, splitFromRows } from './matchStats';

const rows = [
  { isHome: true, gf: 2, ga: 1, opponent: 'Burnley' },
  { isHome: false, gf: 1, ga: 1, opponent: 'Leeds' },
  { isHome: true, gf: 3, ga: 0, opponent: 'Everton' },
  { isHome: false, gf: 0, ga: 2, opponent: 'Liverpool' },
  { isHome: true, gf: 2, ga: 2, opponent: 'Chelsea' },
  { isHome: false, gf: 1, ga: 0, opponent: 'Fulham' },
  { isHome: true, gf: 4, ga: 1, opponent: 'Burnley' },
  { isHome: false, gf: 2, ga: 1, opponent: 'Brentford' },
  { isHome: true, gf: 1, ga: 0, opponent: 'Wolves' },
  { isHome: false, gf: 2, ga: 2, opponent: 'Palace' },
];

describe('match stats', () => {
  it('builds last-10 splits without inventing extra games', () => {
    const snap = snapshotFromRows('h', 'Arsenal', true, rows);
    expect(snap.sampleSize).toBe(10);
    expect(snap.last5.length).toBe(5);
    expect(snap.last10?.length).toBe(10);
    expect(snap.overall?.played).toBe(10);
    expect(snap.homeSplit?.played).toBe(5);
    expect(snap.awaySplit?.played).toBe(5);
    expect(snap.dataReliability).toBe('GOOD');
  });

  it('returns UNKNOWN delivery when the sample is too small', () => {
    const home = snapshotFromRows('h', 'Arsenal', true, rows.slice(0, 2));
    const away = snapshotFromRows('a', 'Burnley', false, rows.slice(0, 2));
    const d = sampleDelivery('OVER_1_5', home, away);
    expect(d.rate).toBeNull();
    expect(d.note).toContain('UNKNOWN');
  });

  it('computes over 1.5 delivery from combined recent rows', () => {
    const home = snapshotFromRows('h', 'Arsenal', true, rows);
    const away = snapshotFromRows('a', 'Burnley', false, rows);
    const d = sampleDelivery('OVER_1_5', home, away);
    const split = splitFromRows(rows);
    expect(d.sample).toBe(20);
    expect(d.rate).toBe(Math.round(((split.over15 * 2) / 20) * 1000) / 10);
  });

  it('summarises last-5 goals for capability picks', () => {
    const snap = snapshotFromRows('h', 'Arsenal', true, rows);
    const p = last5Profile(snap);
    expect(p.n).toBe(5);
    expect(p.gf).toBeGreaterThanOrEqual(1.5);
    expect(p.scored2).toBeGreaterThanOrEqual(3);
    expect(p.known).toBe(true);
  });

  it('uses a single last result instead of treating it as 0-0', () => {
    const snap = snapshotFromRows('h', 'Real Madrid', true, [
      { isHome: true, gf: 2, ga: 2, opponent: 'Fiorentina' },
    ]);
    const p = last5Profile(snap);
    expect(p.n).toBe(1);
    expect(p.lastOver25).toBe(true);
    expect(p.lastTotal).toBe(4);
    expect(p.over25).toBe(1);
  });
});
