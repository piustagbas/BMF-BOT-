import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { StrategyId } from '@memecoinbot/shared';
import type { Timeframe } from '@memecoinbot/indicators';
import { BacktestsService } from './backtests.service';

@Controller()
export class BacktestsController {
  constructor(private readonly backtestsService: BacktestsService) {}

  @Get('backtests')
  list() {
    return this.backtestsService.list();
  }

  @Get('backtests/:id')
  getOne(@Param('id') id: string) {
    return this.backtestsService.getOne(id);
  }

  @Post('backtests')
  run(
    @Body()
    body: {
      address: string;
      timeframe?: Timeframe;
      startingBalance?: number;
      strategyId?: StrategyId | 'ALL';
      outOfSamplePct?: number;
      symbol?: string;
    },
  ) {
    return this.backtestsService.run(body);
  }

  @Get('signal-outcomes')
  listOutcomes() {
    return this.backtestsService.listOutcomes();
  }

  @Post('signal-outcomes')
  track(@Body() body: { address: string }) {
    return this.backtestsService.trackAddress(body.address);
  }
}
