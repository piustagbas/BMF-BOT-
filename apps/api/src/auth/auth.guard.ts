import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { User, type IUser } from '@memecoinbot/db';

export type AuthedRequest = {
  headers: { authorization?: string };
  user?: IUser;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Access denied. No token provided.');
    }
    const token = header.slice(7);
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new UnauthorizedException('JWT_SECRET is not defined');
    }
    try {
      const decoded = jwt.verify(token, secret) as { id: string };
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        throw new UnauthorizedException('Token is valid but user no longer exists.');
      }
      if (!user.isVerified) {
        throw new UnauthorizedException('Please verify your email before accessing this resource.');
      }
      req.user = user;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid token.');
    }
  }
}
