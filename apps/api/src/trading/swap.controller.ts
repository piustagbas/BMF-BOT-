import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SwapService } from './swap.service';
import type { TradeSide } from '@memecoinbot/db';

@Controller('swap')
@UseGuards(AuthGuard)
export class SwapController {
  constructor(private readonly swap: SwapService) {}

  @Get('config')
  config() {
    const fee = this.swap.feeConfig();
    return {
      network: fee.network,
      router: fee.router,
      platformFeeBps: fee.bps,
      platformFeePct: fee.bps / 100,
      platformFeeWalletConfigured: Boolean(fee.wallet || fee.account),
      supportedWallets: ['phantom', 'solflare', 'manual'],
      percentPresets: [10, 25, 50, 75, 100],
      tpslMode: 'ALERT',
      tpslNote:
        'Take-profit and stop-loss generate alerts. Automatic sells are not executed (no server keys).',
    };
  }

  @Get('wallet')
  wallet(@CurrentUser() user: IUser) {
    return this.swap.getWallet(user);
  }

  @Post('wallet')
  connect(
    @CurrentUser() user: IUser,
    @Body() body: { address: string; provider?: 'phantom' | 'solflare' | 'manual' },
  ) {
    if (!body?.address) throw new BadRequestException('address required');
    return this.swap.connectWallet(user, body);
  }

  @Delete('wallet')
  disconnect(@CurrentUser() user: IUser) {
    return this.swap.disconnectWallet(user);
  }

  @Post('quote')
  quote(
    @CurrentUser() user: IUser,
    @Body()
    body: {
      side: TradeSide;
      tokenAddress: string;
      amountUsd?: number;
      amountToken?: number;
      percent?: number;
      slippageBps?: number;
      wallet?: string;
    },
  ) {
    if (!body?.tokenAddress) throw new BadRequestException('tokenAddress required');
    if (body.side !== 'BUY' && body.side !== 'SELL') {
      throw new BadRequestException('side must be BUY or SELL');
    }
    return this.swap.quote(user, body);
  }

  @Post('prepare')
  prepare(
    @CurrentUser() user: IUser,
    @Body()
    body: {
      side: TradeSide;
      tokenAddress: string;
      amountUsd?: number;
      amountToken?: number;
      percent?: number;
      slippageBps?: number;
      wallet?: string;
      takeProfitPct?: number | null;
      stopLossPct?: number | null;
      idempotencyKey?: string;
      confirmRealMoney?: boolean;
    },
    @Headers('idempotency-key') headerKey?: string,
  ) {
    return this.swap.prepare(user, {
      ...body,
      idempotencyKey: body.idempotencyKey || headerKey,
    });
  }

  @Post('trades/:id/submit')
  submit(
    @CurrentUser() user: IUser,
    @Param('id') id: string,
    @Body() body: { signature: string; idempotencyKey?: string },
  ) {
    if (!body?.signature) throw new BadRequestException('signature required');
    return this.swap.submit(user, id, body);
  }

  @Post('trades/:id/reject')
  reject(
    @CurrentUser() user: IUser,
    @Param('id') id: string,
    @Body() body?: { reason?: string },
  ) {
    return this.swap.reject(user, id, body?.reason);
  }

  @Get('trades/:id')
  getOne(@CurrentUser() user: IUser, @Param('id') id: string) {
    return this.swap.refreshStatus(user, id);
  }

  @Get('trades')
  list(@CurrentUser() user: IUser, @Query('limit') limit?: string) {
    return this.swap.listTrades(user, limit ? Number(limit) : 50);
  }

  @Get('positions')
  positions(@CurrentUser() user: IUser) {
    return this.swap.listPositions(user);
  }

  @Get('portfolio')
  portfolio(@CurrentUser() user: IUser) {
    return this.swap.portfolio(user);
  }

  @Put('positions/:id/tpsl')
  setTpsl(
    @CurrentUser() user: IUser,
    @Param('id') id: string,
    @Body() body: { takeProfitPct?: number | null; stopLossPct?: number | null },
  ) {
    return this.swap.setPositionTpsl(user, id, body);
  }
}
