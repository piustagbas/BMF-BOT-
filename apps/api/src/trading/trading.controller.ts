import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TradingService } from './trading.service';

@Controller()
export class TradingController {
  constructor(private readonly trading: TradingService) {}

  @Get('trades')
  listTrades(@Query('limit') limit?: string) {
    return this.trading.listTrades(limit ? Number(limit) : 30);
  }

  @Get('trades/proposals')
  listProposals(@Query('limit') limit?: string) {
    return this.trading.listProposals(limit ? Number(limit) : 30);
  }

  @Get('trades/:id')
  getOne(@Param('id') id: string) {
    return this.trading.getProposal(id);
  }

  @Get('positions')
  listPositions() {
    return this.trading.listPositions();
  }

  @Post('trades/propose')
  propose(@Body() body: { address: string; sizeUsd?: number }) {
    if (!body?.address?.trim()) {
      throw new BadRequestException('address required');
    }
    return this.trading.propose(body.address.trim(), { sizeUsd: body.sizeUsd });
  }

  @Post('trades/:id/approve')
  approve(
    @Param('id') id: string,
    @Body() body: { confirmRealMoney?: boolean },
  ) {
    return this.trading.approve(id, body);
  }

  @Post('trades/:id/reject')
  reject(@Param('id') id: string) {
    return this.trading.reject(id);
  }

  @Post('trades/:id/prepare')
  prepare(@Param('id') id: string) {
    return this.trading.prepare(id);
  }

  @Post('trades/:id/record')
  record(@Param('id') id: string, @Body() body: { txSignature: string }) {
    return this.trading.record(id, body);
  }
}
