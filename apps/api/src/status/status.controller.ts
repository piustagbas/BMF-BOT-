import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AutoTradingService } from '../trading/auto-trading.service';

@Controller()
export class StatusController {
  constructor(private readonly autoTrading: AutoTradingService) {}

  @Get('auto-trading/status')
  getAutoTradingStatus() {
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
