import { Controller, Get, Param, Query } from '@nestjs/common';
import { isTimeframe } from '@memecoinbot/indicators';
import { SignalsService } from './signals.service';

@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('scan') scan?: string,
  ) {
    if (scan === '1' || scan === 'true') {
      const items = await this.signalsService.scanTop(
        limit ? Number(limit) : 5,
      );
      return { items, count: items.length, mode: 'scan' };
    }
    const items = this.signalsService.listRecent(limit ? Number(limit) : 20);
    return { items, count: items.length, mode: 'recent' };
  }

  @Get('results')
  async results(@Query('refresh') refresh?: string) {
    if (refresh === '1' || refresh === 'true') {
      return this.signalsService.refreshBuyResults();
    }
    return this.signalsService.listBuyResults();
  }

  @Get('token/:address')
  generate(
    @Param('address') address: string,
    @Query('tf') tf?: string,
    @Query('confirmTf') confirmTf?: string,
  ) {
    return this.signalsService.generateForAddress(address, {
      primaryTf: isTimeframe(tf) ? tf : undefined,
      confirmTf: isTimeframe(confirmTf) ? confirmTf : undefined,
    });
  }
}
