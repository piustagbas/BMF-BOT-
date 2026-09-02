import { describe, expect, it } from 'vitest';
import { listFixtures } from './football.provider';

describe('fixture board coverage', () => {
  it(
    'returns today matches from the upcoming board and dated query',
    async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
      const all = await listFixtures({});
      const dated = await listFixtures({ dateFrom: today, dateTo: today });
      const todayUpcoming = all.items.filter(
        (f) =>
          new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(f.kickoffUtc)) === today,
      );
      expect(todayUpcoming.length).toBeGreaterThan(1);
      expect(dated.items.length).toBeGreaterThan(0);
    },
    120_000,
  );
});
