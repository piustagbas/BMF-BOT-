import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BetBotService, type SlipSelection } from './bet-bot.service';
import type { BookmakerId } from './types';

@Controller('bet-bot')
@UseGuards(AuthGuard)
export class BetBotController {
  constructor(private readonly betBot: BetBotService) {}

  @Get('status')
  status() {
    return this.betBot.status();
  }

  @Get('fixtures')
  fixtures(
    @Query('q') q?: string,
    @Query('league') league?: string,
    @Query('popular') popular?: string,
    @Query('date') date?: string,
    @Query('kickoffFrom') kickoffFrom?: string,
    @Query('kickoffTo') kickoffTo?: string,
  ) {
    return this.betBot.fixtures({ q, league, popular, date, kickoffFrom, kickoffTo });
  }

  @Get('picks')
  picks() {
    return this.betBot.picks();
  }

  @Get('picks/booking')
  booking() {
    return this.betBot.bookingSlip();
  }

  @Get('fixtures/live')
  live(
    @Query('q') q?: string,
    @Query('league') league?: string,
    @Query('popular') popular?: string,
  ) {
    return this.betBot.liveBoard({ q, league, popular });
  }

  @Get('fixtures/:id')
  analyze(@Param('id') id: string) {
    return this.betBot.analyze(id);
  }

  @Get('slip')
  slips(@CurrentUser() user: IUser) {
    return this.betBot.listSlips(String(user._id));
  }

  @Post('slip')
  quote(
    @CurrentUser() user: IUser,
    @Body() body: { bookmaker: BookmakerId; selections: SlipSelection[] },
  ) {
    return this.betBot.quoteSlip(String(user._id), body.bookmaker, body.selections ?? []);
  }

  @Post('ticket/verify')
  verify(
    @Body()
    body: {
      bookmaker: BookmakerId;
      bookingCode?: string;
      pastedSelections?: Array<{ match?: string; market?: string; odds?: number }>;
      botSelections: SlipSelection[];
    },
  ) {
    return this.betBot.verifyTicket(body);
  }
}
