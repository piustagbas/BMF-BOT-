import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { IUser } from '@memecoinbot/db';
import type { AuthedRequest } from './auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): IUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) {
      throw new Error('CurrentUser used without AuthGuard');
    }
    return req.user;
  },
);
