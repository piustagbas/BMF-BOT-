import { describe, expect, it } from 'vitest';
import {
  leagueCountry,
  leagueHeading,
  countryFlag,
  isListedFootball,
  isTopLeague,
  topCountryRank,
  compareByMatchDay,
  matchDayRank,
  isOnCalendarDay,
} from './popular';

describe('league country headings', () => {
  it('maps top leagues to country · league with flags', () => {
    expect(leagueCountry('English Premier League')).toBe('England');
    expect(leagueCountry('La Liga')).toBe('Spain');
    expect(leagueCountry('Serie A')).toBe('Italy');
    expect(leagueCountry('Bundesliga')).toBe('Germany');
    expect(leagueCountry('Ligue 1')).toBe('France');
    expect(leagueCountry('UEFA Champions League')).toBe('Europe');
    expect(leagueCountry('Süper Lig')).toBe('Turkey');
    expect(leagueCountry('Dutch Eredivisie')).toBe('Netherlands');
    expect(leagueCountry('Liga Portugal Betclic')).toBe('Portugal');
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

  it('maps FotMob 3-letter country codes to flags', () => {
    expect(leagueCountry('Liga Profesional', 'ARG')).toBe('Argentina');
    expect(countryFlag(leagueCountry('Saudi Pro League', 'KSA'))).toBe('🇸🇦');
    expect(countryFlag(leagueCountry('NPFL', 'NGA'))).toBe('🇳🇬');
  });

  it('uses league name when feed country is INT or International', () => {
    expect(leagueCountry('Champions League', 'INT')).toBe('Europe');
    expect(leagueCountry('Europa League', 'INT')).toBe('Europe');
    expect(leagueCountry('Ekstraklasa', 'INT')).toBe('Poland');
    expect(leagueCountry('Premier League', 'GHA')).toBe('Ghana');
    expect(leagueCountry('Premier League', 'ENG')).toBe('England');
  });

  it('flags top-flight leagues in the most followed countries', () => {
    expect(isTopLeague('English Premier League')).toBe(true);
    expect(isTopLeague('La Liga')).toBe(true);
    expect(isTopLeague('Serie A')).toBe(true);
    expect(isTopLeague('Bundesliga')).toBe(true);
    expect(isTopLeague('Ligue 1')).toBe(true);
    expect(isTopLeague('UEFA Champions League')).toBe(true);
    expect(isTopLeague('Eredivisie')).toBe(true);
    expect(isTopLeague('Dutch Eredivisie')).toBe(true);
    expect(isTopLeague('Liga Portugal Betclic')).toBe(true);
    expect(isTopLeague('Portuguese Primeira Liga')).toBe(true);
    expect(isTopLeague('Süper Lig')).toBe(true);
    expect(isTopLeague('Trendyol Süper Lig')).toBe(true);
    expect(isTopLeague('Turkish Super Lig')).toBe(true);
    expect(isTopLeague('Eerste Divisie')).toBe(false);
    expect(isTopLeague('Nigerian Premier League')).toBe(true);
    expect(isTopLeague('Campeonato Brasileiro Série A')).toBe(true);
    expect(isTopLeague('English Championship')).toBe(false);
    expect(isTopLeague('Serie B')).toBe(false);
    expect(isTopLeague('2. Bundesliga')).toBe(false);
    expect(topCountryRank('England')).toBeLessThan(topCountryRank('Nigeria'));
    expect(topCountryRank('England')).toBeLessThan(topCountryRank('Brazil'));
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

  it('treats UTC and local calendar days as today so midnight TZ splits still list matches', () => {
    const now = new Date(Date.UTC(2026, 7, 29, 12, 0, 0));
    expect(isOnCalendarDay('2026-08-29T15:00:00Z', now, 'today')).toBe(true);
    expect(isOnCalendarDay('2026-08-30T16:00:00Z', now, 'today')).toBe(false);
    const lateUtc = new Date(Date.UTC(2026, 7, 29, 0, 30, 0));
    expect(isOnCalendarDay('2026-08-29T00:10:00Z', lateUtc, 'today')).toBe(true);
  });
});
