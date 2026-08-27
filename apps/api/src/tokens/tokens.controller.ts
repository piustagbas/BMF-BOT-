import { Controller, Get, Param, Query } from '@nestjs/common';
import { TokensService } from './tokens.service';

@Controller('tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get()
  list(
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    return this.tokensService.listTokens({
      sort,
      limit: limit ? Number(limit) : undefined,
      q,
    });
  }

  @Get(':address/ohlcv')
  getOhlcv(
    @Param('address') address: string,
    @Query('tf') tf?: string,
    @Query('limit') limit?: string,
    @Query('pair') pair?: string,
  ) {
    return this.tokensService.getOhlcv(address, {
      timeframe: tf,
      limit: limit ? Number(limit) : undefined,
      pairAddress: pair,
    });
  }

  @Get(':address')
  getOne(@Param('address') address: string) {
    return this.tokensService.getToken(address);
  }
}
