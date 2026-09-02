import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BetBotController } from './bet-bot.controller';
import { BetBotService } from './bet-bot.service';
import { FootballAnalysisController } from './football-analysis.controller';
import { ApiFootballProvider } from './api-football.provider';
import { BacktestingService } from './backtesting.service';
import { FootballAnalysisService } from './football-analysis.service';
import { FootballDataOrgProvider } from './football-data-org.provider';
import { FixtureMatchingService } from './fixture-matching.service';
import { FootballPersistenceService } from './football-persistence.service';
import { FootballStatisticsService } from './football-statistics.service';
import { OpenAiAnalysisService } from './openai-analysis.service';
import { PredictionEngine } from './prediction-engine';
import { ProviderConsensusService } from './provider-consensus.service';
import { ProviderHealthService } from './provider-health.service';
import { SportmonksProvider } from './sportmonks.provider';

@Module({
  imports: [AuthModule],
  controllers: [BetBotController, FootballAnalysisController],
  providers: [
    BetBotService,
    FootballAnalysisService,
    FixtureMatchingService,
    FootballStatisticsService,
    PredictionEngine,
    ProviderConsensusService,
    OpenAiAnalysisService,
    BacktestingService,
    FootballPersistenceService,
    ProviderHealthService,
    SportmonksProvider,
    ApiFootballProvider,
    FootballDataOrgProvider,
  ],
})
export class BetBotModule {}
