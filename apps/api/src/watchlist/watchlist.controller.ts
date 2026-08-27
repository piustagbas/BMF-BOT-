import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WatchlistService } from './watchlist.service';

@Controller('watchlist')
@UseGuards(AuthGuard)
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list(@CurrentUser() user: IUser) {
    return this.watchlist.list(user);
  }

  @Post()
  add(
    @CurrentUser() user: IUser,
    @Body() body: { address: string; notes?: string },
  ) {
    return this.watchlist.add(user, body.address, body.notes);
  }

  @Post('refresh')
  refresh(@CurrentUser() user: IUser) {
    return this.watchlist.refresh(user);
  }

  @Delete(':address')
  remove(@CurrentUser() user: IUser, @Param('address') address: string) {
    return this.watchlist.remove(user, address);
  }

  @Get(':address/exists')
  exists(@CurrentUser() user: IUser, @Param('address') address: string) {
    return this.watchlist.has(user, address);
  }
}
