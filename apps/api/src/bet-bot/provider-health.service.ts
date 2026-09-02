import { Injectable } from '@nestjs/common';
import type { FootballProviderName, ProviderHealth } from './football-data.types';

@Injectable()
export class ProviderHealthService {
  private readonly latest = new Map<FootballProviderName, ProviderHealth>();

  update(health: ProviderHealth): void {
    this.latest.set(health.provider, health);
  }

  all(): ProviderHealth[] {
    return (['sportmonks', 'apiFootball', 'footballDataOrg'] as FootballProviderName[]).map((provider) =>
      this.latest.get(provider) ?? {
        provider,
        status: 'disabled',
        responseTimeMs: null,
        errors: 0,
        rateLimitResponses: 0,
        lastSuccessfulSync: null,
        fixturesReceived: 0,
        message: 'No sync has run yet',
      },
    );
  }
}
