import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { FootballAnalysisService } from './football-analysis.service';
import { footballTimezone } from './football-data.utils';

@Controller()
@UseGuards(AuthGuard)
export class FootballAnalysisController {
  constructor(private readonly analysis: FootballAnalysisService) {}

  @Get('fixtures')
  fixtures(
    @Query('date') date?: string,
    @Query('day') day?: string,
    @Query('league') league?: string,
    @Query('provider') provider?: string,
  ) {
    return this.analysis.fixtures({ date, day, league, provider });
  }

  @Get('fixtures/:id')
  fixture(@Param('id') id: string) {
    return this.analysis.fixtureData(decodeURIComponent(id));
  }

  @Get('fixtures/:id/data')
  fixtureData(@Param('id') id: string) {
    return this.analysis.fixtureData(decodeURIComponent(id));
  }

  @Get('analysis/:id')
  analyze(@Param('id') id: string) {
    return this.analysis.analyze(decodeURIComponent(id));
  }

  @Get('predictions/today')
  today() {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: footballTimezone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return this.analysis.top({ date });
  }

  @Get('predictions/top')
  top(
    @Query('date') date?: string,
    @Query('day') day?: string,
    @Query('league') league?: string,
    @Query('provider') provider?: string,
    @Query('market') market?: string,
    @Query('risk') risk?: string,
    @Query('minimumProbability') minimumProbability?: string,
    @Query('minProbability') minProbability?: string,
    @Query('minimumConfidence') minimumConfidence?: string,
    @Query('minConfidence') minConfidence?: string,
  ) {
    return this.analysis.top({
      date,
      day,
      league,
      provider,
      market,
      risk,
      minimumProbability: this.numberOrUndefined(minimumProbability ?? minProbability),
      minimumConfidence: this.numberOrUndefined(minimumConfidence ?? minConfidence),
    });
  }

  @Get('predictions/:id')
  prediction(@Param('id') id: string) {
    return this.analysis.analyze(decodeURIComponent(id));
  }

  @Get('backtesting')
  backtesting(@Query('date') date?: string, @Query('day') day?: string) {
    return this.analysis.backtest({ date, day });
  }

  @Get('providers/status')
  providerStatus() {
    return this.analysis.providerStatus();
  }

  private numberOrUndefined(value: string | undefined): number | undefined {
    if (!value || !Number.isFinite(Number(value))) return undefined;
    return Number(value);
  }
}
