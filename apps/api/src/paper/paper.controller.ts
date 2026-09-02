import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import type { PaperTestEvent } from '@memecoinbot/paper-engine';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
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
  @UseGuards(AuthGuard)
  openFromSignal(@CurrentUser() user: IUser, @Body() body: { address: string }) {
    return this.paperService.openFromSignal(body.address, user);
  }

  @Post('paper-trades/manual')
  @UseGuards(AuthGuard)
  openManual(
    @CurrentUser() user: IUser,
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
    return this.paperService.openManual(body, user);
  }

  @Post('paper-positions/sync')
  @UseGuards(AuthGuard)
  sync(@CurrentUser() user: IUser) {
    return this.paperService.syncPrices(user);
  }

  @Post('paper-positions/:id/test')
  @UseGuards(AuthGuard)
  testEvent(
    @CurrentUser() user: IUser,
    @Param('id') id: string,
    @Body() body: { event: PaperTestEvent },
  ) {
    return this.paperService.applyTest(id, body.event, user);
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
