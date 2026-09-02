import { Injectable } from '@nestjs/common';
import type { FootballProviderName, NormalizedFixture, ProviderAgreement, ProviderFetchResult } from './football-data.types';
import type { MatchedFixture } from './fixture-matching.service';

@Injectable()
export class ProviderConsensusService {
  agreement(group: MatchedFixture): ProviderAgreement {
    const providers = Object.keys(group.providerFixtures) as FootballProviderName[];
    const discrepancies = [...new Set(group.discrepancies)];
    const available = providers.length;
    const score = Math.max(0, Math.round((available / 3) * 100) - discrepancies.length * 8);
    return {
      available,
      total: 3,
      score,
      label: `${available}/3`,
      discrepancies,
    };
  }

  mergeResults(group: MatchedFixture, providerResults: ProviderFetchResult[]): {
    result: { homeGoals: number; awayGoals: number } | null;
    discrepancies: string[];
  } {
    const matches: Array<{ provider: FootballProviderName; homeGoals: number; awayGoals: number }> = [];
    for (const provider of Object.keys(group.providerFixtures) as FootballProviderName[]) {
      const fixture = group.providerFixtures[provider];
      if (!fixture) continue;
      const result = providerResults
        .flatMap((item) => item.results)
        .find((item) => item.provider === provider && item.providerFixtureId === fixture.providerFixtureId);
      if (result) matches.push({ provider, homeGoals: result.homeGoals, awayGoals: result.awayGoals });
    }
    const discrepancies = matches.length > 1 && new Set(matches.map((item) => `${item.homeGoals}-${item.awayGoals}`)).size > 1
      ? ['Provider discrepancy detected: finished score differs between providers']
      : [];
    return { result: matches[0] ?? null, discrepancies };
  }

  primary(group: MatchedFixture): NormalizedFixture {
    return {
      ...group.fixture,
      provider: group.fixture.provider,
      providerFixtureId: group.providerIds[group.fixture.provider] ?? group.fixture.providerFixtureId,
      source: group.fixture.source,
      discrepancies: [...new Set(group.discrepancies)],
    };
  }
}
