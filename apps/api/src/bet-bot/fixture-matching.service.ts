import { Injectable } from '@nestjs/common';
import type { FootballProviderName, NormalizedFixture, ProviderAgreement } from './football-data.types';

export type MatchedFixture = {
  internalId: string;
  fixture: NormalizedFixture;
  providerFixtures: Partial<Record<FootballProviderName, NormalizedFixture>>;
  providerIds: Partial<Record<FootballProviderName, string>>;
  discrepancies: string[];
};

export function normalizeTeamName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|ac|ssc|ud|cd|the|club)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bman united\b/g, 'manchester united')
    .replace(/\bman city\b/g, 'manchester city')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamSimilarity(a: string, b: string): number {
  const x = normalizeTeamName(a);
  const y = normalizeTeamName(b);
  if (!x || !y) return 0;
  if (x === y || x.includes(y) || y.includes(x)) return 1;
  const left = new Set(x.split(' '));
  const right = new Set(y.split(' '));
  const overlap = [...left].filter((token) => right.has(token) && token.length > 2).length;
  return overlap / Math.max(left.size, right.size);
}

function isSameFixture(left: NormalizedFixture, right: NormalizedFixture): boolean {
  const home = teamSimilarity(left.homeTeam.name, right.homeTeam.name);
  const away = teamSimilarity(left.awayTeam.name, right.awayTeam.name);
  if (home < 0.5 || away < 0.5) return false;
  const delta = Math.abs(Date.parse(left.kickoffUtc) - Date.parse(right.kickoffUtc));
  return Number.isFinite(delta) && delta <= 36 * 60 * 60 * 1000;
}

function stableId(fixture: NormalizedFixture): string {
  const home = normalizeTeamName(fixture.homeTeam.name).replace(/\s/g, '-');
  const away = normalizeTeamName(fixture.awayTeam.name).replace(/\s/g, '-');
  return `fixture:${fixture.date}:${home}:${away}`;
}

@Injectable()
export class FixtureMatchingService {
  match(fixtures: NormalizedFixture[]): MatchedFixture[] {
    const groups: MatchedFixture[] = [];
    for (const fixture of fixtures) {
      const existing = groups.find((group) => isSameFixture(group.fixture, fixture));
      if (!existing) {
        groups.push({
          internalId: stableId(fixture),
          fixture: { ...fixture, internalId: stableId(fixture) },
          providerFixtures: { [fixture.provider]: fixture },
          providerIds: { [fixture.provider]: fixture.providerFixtureId },
          discrepancies: [],
        });
        continue;
      }
      existing.providerFixtures[fixture.provider] = fixture;
      existing.providerIds[fixture.provider] = fixture.providerFixtureId;
      existing.discrepancies.push(...this.compare(existing.fixture, fixture));
      existing.fixture = {
        ...existing.fixture,
        internalId: existing.internalId,
        leagueName: existing.fixture.leagueName || fixture.leagueName,
        venue: existing.fixture.venue || fixture.venue,
        status: existing.fixture.status || fixture.status,
        discrepancies: [...new Set(existing.discrepancies)],
        source: {
          ...existing.fixture.source,
          fetchedAt: new Date().toISOString(),
        },
      };
    }
    return groups.map((group) => ({
      ...group,
      discrepancies: [...new Set(group.discrepancies)],
      fixture: { ...group.fixture, discrepancies: [...new Set(group.discrepancies)] },
    }));
  }

  agreement(group: MatchedFixture, field: 'kickoff' | 'league' = 'kickoff'): ProviderAgreement {
    const available = Object.keys(group.providerFixtures).length;
    const discrepancies = field === 'kickoff' ? group.discrepancies.filter((item) => item.includes('kickoff')) : group.discrepancies.filter((item) => item.includes('league'));
    const total = 3;
    const score = total ? Math.round((available / total) * 100) : 0;
    return {
      available,
      total,
      score,
      label: `${available}/${total}`,
      discrepancies,
    };
  }

  private compare(primary: NormalizedFixture, next: NormalizedFixture): string[] {
    const differences: string[] = [];
    const kickoffDelta = Math.abs(Date.parse(primary.kickoffUtc) - Date.parse(next.kickoffUtc));
    if (kickoffDelta > 5 * 60 * 1000) differences.push(`Provider discrepancy detected: kickoff differs by ${Math.round(kickoffDelta / 60000)} minutes`);
    if (primary.leagueName && next.leagueName && normalizeTeamName(primary.leagueName) !== normalizeTeamName(next.leagueName)) {
      differences.push(`Provider discrepancy detected: league differs (${primary.leagueName} vs ${next.leagueName})`);
    }
    if (primary.homeTeam.name !== next.homeTeam.name || primary.awayTeam.name !== next.awayTeam.name) {
      differences.push('Provider discrepancy detected: team naming differs');
    }
    return differences;
  }
}
