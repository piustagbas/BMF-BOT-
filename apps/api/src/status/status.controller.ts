import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AutoTradingService } from '../trading/auto-trading.service';
import { SettingsService } from '../settings/settings.service';

@Controller()
export class StatusController {
  constructor(
    private readonly autoTrading: AutoTradingService,
    private readonly settings: SettingsService,
  ) {}

  @Get('auto-trading/status')
  @UseGuards(AuthGuard)
  async getAutoTradingStatus(@CurrentUser() user: IUser) {
    await this.settings.hydrateFromUser(user);
    return this.autoTrading.getStatus();
  }

  @Post('auto-trading/enable')
  enable(
    @Body()
    body: { confirmRealMoney?: boolean; acknowledgeWarning?: boolean },
  ) {
    return this.autoTrading.enable(body ?? {});
  }

  @Post('auto-trading/disable')
  disable() {
    return this.autoTrading.disable();
  }

  @Post('auto-trading/emergency-stop')
  emergencyStop() {
    return this.autoTrading.emergencyStop();
  }

  @Post('auto-trading/run')
  run(@Body() body?: { limit?: number }) {
    return this.autoTrading.runCycle({ limit: body?.limit });
  }

  @Get('auto-trading/last-cycle')
  lastCycle(@Query('unused') _unused?: string) {
    return this.autoTrading.getLastCycle() ?? { message: 'No cycle run yet' };
  }
}
