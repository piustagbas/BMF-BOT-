import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
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
  scan() {
    return this.forex.scan();
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
  execute(@Param('id') id: string, @Body() body: { side?: 'BUY' | 'SELL' }) {
    return this.forex.execute(id, body.side === 'SELL' ? 'SELL' : 'BUY');
  }

  @Get('positions')
  positions() {
    return this.forex.positionsList();
  }

  @Post('positions/tick')
  tick() {
    return this.forex.tick();
  }

  @Post('positions/:id/close')
  close(@Param('id') id: string) {
    return this.forex.close(id);
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
