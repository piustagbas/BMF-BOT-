import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { PaperTestEvent } from '@memecoinbot/paper-engine';
import { PaperService } from './paper.service';

@Controller()
export class PaperController {
  constructor(private readonly paperService: PaperService) {}

  @Get('paper-account')
  getAccount() {
    return this.paperService.getAccount();
  }

  @Get('performance')
  getPerformance() {
    return this.paperService.getPerformance();
  }

  @Get('paper-positions')
  getPositions() {
    return this.paperService.getPositions();
  }

  @Get('paper-trades')
  getTrades() {
    return this.paperService.getTrades();
  }

  @Post('paper-account/reset')
  reset(@Body() body?: { startingBalance?: number }) {
    return this.paperService.reset(body?.startingBalance);
  }

  @Post('paper-trades/from-signal')
  openFromSignal(@Body() body: { address: string }) {
    return this.paperService.openFromSignal(body.address);
  }

  @Post('paper-trades/manual')
  openManual(
    @Body()
    body: {
      address: string;
      entryPrice?: number;
      stopLoss: number;
      tp1Price: number;
      tp2Price: number;
      symbol?: string;
    },
  ) {
    return this.paperService.openManual(body);
  }

  @Post('paper-positions/sync')
  sync() {
    return this.paperService.syncPrices();
  }

  @Post('paper-positions/:id/test')
  testEvent(
    @Param('id') id: string,
    @Body() body: { event: PaperTestEvent },
  ) {
    return this.paperService.applyTest(id, body.event);
  }

  @Get('paper/dashboard')
  dashboard(@Query('unused') _unused?: string) {
    return {
      account: this.paperService.getAccount(),
      performance: this.paperService.getPerformance(),
      positions: this.paperService.getPositions(),
      trades: this.paperService.getTrades(),
    };
  }
}
