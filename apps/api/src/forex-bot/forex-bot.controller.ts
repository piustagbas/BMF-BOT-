import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ForexBotService } from './forex-bot.service';

@Controller('forex-bot')
@UseGuards(AuthGuard)
export class ForexBotController {
  constructor(private readonly forex: ForexBotService) {}

  @Get('status')
  status() {
    return this.forex.status();
  }

  @Get('scan')
  scan(@Query('symbol') symbol?: string, @Query('interval') interval?: string) {
    if (symbol) return this.forex.pairDetail(symbol, interval);
    return this.forex.scan();
  }

  @Get('pairs/:symbol')
  pair(@Param('symbol') symbol: string, @Query('interval') interval?: string) {
    return this.forex.pairDetail(symbol, interval);
  }

  @Get('pair/:symbol')
  pairAlias(@Param('symbol') symbol: string, @Query('interval') interval?: string) {
    return this.forex.pairDetail(symbol, interval);
  }

  @Get('signals')
  signals() {
    return this.forex.signalsList();
  }

  @Get('signals/:id')
  signal(@Param('id') id: string) {
    return this.forex.getSignal(id);
  }

  @Post('signals/:id/recheck')
  recheck(@Param('id') id: string, @Body() body: { side?: 'BUY' | 'SELL' }) {
    return this.forex.recheck(id, body.side === 'SELL' ? 'SELL' : 'BUY');
  }

  @Post('signals/:id/execute')
  execute(
    @CurrentUser() user: IUser,
    @Param('id') id: string,
    @Body() body: { side?: 'BUY' | 'SELL' },
  ) {
    return this.forex.execute(id, body.side === 'SELL' ? 'SELL' : 'BUY', user);
  }

  @Get('positions')
  positions() {
    return this.forex.positionsList();
  }

  @Post('positions/tick')
  tick(@CurrentUser() user: IUser) {
    return this.forex.tick(user);
  }

  @Post('positions/:id/close')
  close(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.forex.close(id, user);
  }

  @Get('journal')
  journal() {
    return this.forex.journalList();
  }

  @Get('risk')
  risk() {
    return this.forex.risk();
  }

  @Get('calendar')
  calendar() {
    return this.forex.calendar();
  }

  @Get('backtest')
  backtest() {
    return this.forex.backtest();
  }

  @Post('kill-switch')
  kill(@Body() body: { on?: boolean }) {
    return this.forex.setKillSwitch(body.on !== false);
  }

  @Post('mode')
  mode(@Body() body: { mode?: 'PAPER' | 'LIVE' }) {
    return this.forex.setMode(body.mode === 'LIVE' ? 'LIVE' : 'PAPER');
  }

  @Post('emergency-stop')
  emergency() {
    return this.forex.emergencyStop();
  }
}
