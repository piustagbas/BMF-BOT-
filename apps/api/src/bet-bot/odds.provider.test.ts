import { describe, expect, it } from 'vitest';
import { deriveComboMarkets, matchCatalogEvent, pickGuideBookmaker, pricesFromBook } from './odds.provider';

describe('odds guide helpers', () => {
  it('derives double chance from 1X2 guide prices', () => {
    const extra = deriveComboMarkets({ HOME: 2, DRAW: 3.5, AWAY: 4 });
    expect(extra.DC_1X).toBeGreaterThan(1);
    expect(extra.DC_1X).toBeLessThan(2);
    expect(extra.DC_12).toBeGreaterThan(1);
  });

  it('matches catalog events by team name', () => {
    const hit = matchCatalogEvent(
      [
        { home: 'Manchester United', away: 'Chelsea', commence: '', prices: { HOME: 2.1 }, bookKey: 'pinnacle' },
      ],
      'Man United',
      'Chelsea FC',
    );
    expect(hit?.prices.HOME).toBe(2.1);
  });

  it('prefers a named book then the one with most markets', () => {
    const books = [
      { key: 'betfair', markets: [{ key: 'h2h' }] },
      { key: 'pinnacle', markets: [{ key: 'h2h' }, { key: 'totals' }] },
    ];
    expect(pickGuideBookmaker(books, 'betfair')?.key).toBe('betfair');
    expect(pickGuideBookmaker(books)?.key).toBe('pinnacle');
  });

  it('maps h2h and totals from a guide book', () => {
    const prices = pricesFromBook(
      {
        key: 'pinnacle',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Arsenal', price: 1.8 },
              { name: 'Draw', price: 3.6 },
              { name: 'Burnley', price: 4.5 },
            ],
          },
          {
            key: 'totals',
            outcomes: [
              { name: 'Over', point: 1.5, price: 1.33 },
              { name: 'Under', point: 1.5, price: 3.4 },
            ],
          },
        ],
      },
      'Arsenal',
      'Burnley',
    );
    expect(prices.HOME).toBe(1.8);
    expect(prices.OVER_1_5).toBe(1.33);
    expect(prices.DC_1X).toBeGreaterThan(1);
  });
});
