import { describe, expect, it } from 'vitest';
import {
  leagueCountry,
  leagueHeading,
  countryFlag,
  isListedFootball,
  compareByMatchDay,
  matchDayRank,
} from './popular';

describe('league country headings', () => {
  it('maps top leagues to country · league with flags', () => {
    expect(leagueCountry('English Premier League')).toBe('England');
    expect(leagueCountry('La Liga')).toBe('Spain');
    expect(leagueCountry('Serie A')).toBe('Italy');
    expect(leagueCountry('Bundesliga')).toBe('Germany');
    expect(leagueCountry('Ligue 1')).toBe('France');
    expect(leagueCountry('UEFA Champions League')).toBe('Europe');
    expect(leagueHeading('Premier League')).toBe(`${countryFlag('England')} England · Premier League`);
  });

  it('maps popular and other leagues across countries', () => {
    expect(leagueCountry('Nigerian Premier League')).toBe('Nigeria');
    expect(leagueCountry('NPFL', 'Nigeria')).toBe('Nigeria');
    expect(leagueCountry('Campeonato Brasileiro Série A')).toBe('Brazil');
    expect(leagueCountry('USL Championship', 'USA')).toBe('USA');
    expect(leagueCountry('English Championship')).toBe('England');
    expect(leagueHeading('NPFL', 'Nigeria')).toBe(`${countryFlag('Nigeria')} Nigeria · NPFL`);
  });

  it('uses country flags including England and Nigeria', () => {
    expect(countryFlag('Nigeria')).toBe('🇳🇬');
    expect(countryFlag('Brazil')).toBe('🇧🇷');
    expect(countryFlag('England')).toBe('🏴󠁧󠁢󠁥󠁮󠁧󠁿');
    expect(countryFlag('Europe')).toBe('🇪🇺');
  });

  it('lists football from any country and drops virtual games', () => {
    expect(isListedFootball('American USL Championship')).toBe(true);
    expect(isListedFootball('Nigerian Premier League')).toBe(true);
    expect(isListedFootball('FIFA 23 eSports')).toBe(false);
  });
});

describe('match day order', () => {
  it('puts today before tomorrow before later dates', () => {
    const now = new Date(2026, 7, 26, 18, 0, 0);
    const today = new Date(2026, 7, 26, 20, 0, 0).toISOString();
    const tomorrow = new Date(2026, 7, 27, 15, 0, 0).toISOString();
    const later = new Date(2026, 7, 29, 15, 0, 0).toISOString();
    expect(compareByMatchDay(today, tomorrow, now)).toBeLessThan(0);
    expect(compareByMatchDay(tomorrow, later, now)).toBeLessThan(0);
    expect(compareByMatchDay(later, today, now)).toBeGreaterThan(0);
    expect(matchDayRank(today, now)).toBe(0);
    expect(matchDayRank(tomorrow, now)).toBe(1);
    expect(matchDayRank(later, now)).toBe(2);
  });
});
