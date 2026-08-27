import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { IUser } from '@memecoinbot/db';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('auth/providers')
  providers() {
    return this.auth.authProviders();
  }

  @Post('auth/register')
  register(
    @Body() body: { name: string; email: string; password: string },
  ) {
    return this.auth.register(body);
  }

  @Post('auth/login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body);
  }

  @Get('auth/google')
  googleStart(
    @Query('callback') callback: string,
    @Res() res: Response,
  ) {
    const url = this.auth.startGoogleOAuth(callback);
    return res.redirect(url);
  }

  @Get('auth/google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const { redirectUrl } = await this.auth.finishGoogleOAuth(code, state);
    return res.redirect(redirectUrl);
  }

  @Post('auth/apple')
  apple(
    @Body()
    body: {
      identityToken: string;
      user?: {
        fullName?: { givenName?: string | null; familyName?: string | null };
        email?: string | null;
      };
    },
  ) {
    return this.auth.appleLogin(body);
  }

  @Get('user/profile')
  @UseGuards(AuthGuard)
  profile(@CurrentUser() user: IUser) {
    return this.auth.profile(user);
  }
}
