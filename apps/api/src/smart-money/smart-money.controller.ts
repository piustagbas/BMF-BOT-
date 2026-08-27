import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SmartMoneyService } from './smart-money.service';

@Controller('smart-money')
export class SmartMoneyController {
  constructor(private readonly smartMoney: SmartMoneyService) {}

  @Get('status')
  status() {
    return this.smartMoney.status();
  }

  @Get('wallets')
  list(@Query('sort') sort?: string) {
    const items = this.smartMoney.listWallets(sort || 'smartScore');
    return { items, count: items.length, status: this.smartMoney.status() };
  }

  @Get('wallets/:address')
  one(@Param('address') address: string) {
    return this.smartMoney.getWallet(address);
  }

  @Get('signals')
  signals(@Query('limit') limit?: string) {
    const items = this.smartMoney.listSignals(limit ? Number(limit) : 30);
    return { items, count: items.length };
  }

  @Get('consensus/:address')
  consensus(@Param('address') address: string) {
    const event = this.smartMoney.getConsensus(address);
    return { token: address, consensus: event };
  }

  @Post('cycle')
  async cycle() {
    await this.smartMoney.runCycle();
    return this.smartMoney.status();
  }
}
