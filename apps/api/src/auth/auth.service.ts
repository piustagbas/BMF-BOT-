import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import { User, UserSettings, type IUser } from '@memecoinbot/db';

function publicUser(user: IUser) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    isVerified: user.isVerified,
    authProvider: user.authProvider,
    createdAt: user.createdAt,
  };
}

type GoogleOAuthState = { callbackUrl: string; purpose: 'google_oauth' };

@Injectable()
export class AuthService {
  constructor(private readonly config: ConfigService) {}

  private signToken(id: string): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET is not defined');
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') || '7d';
    return jwt.sign({ id }, secret, { expiresIn } as jwt.SignOptions);
  }

  private googleRedirectUri(): string {
    const serverUrl =
      this.config.get<string>('SERVER_URL') || 'http://localhost:3001';
    return (
      this.config.get<string>('GOOGLE_REDIRECT_URI') ||
      `${serverUrl.replace(/\/$/, '')}/api/auth/google/callback`
    );
  }

  private encodeGoogleState(callbackUrl: string): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET is not defined');
    return jwt.sign(
      { callbackUrl, purpose: 'google_oauth' } satisfies GoogleOAuthState,
      secret,
      { expiresIn: '10m' },
    );
  }

  private decodeGoogleState(state: string): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET is not defined');
    try {
      const payload = jwt.verify(state, secret) as Partial<GoogleOAuthState>;
      if (payload.purpose !== 'google_oauth' || !payload.callbackUrl?.trim()) {
        throw new Error('bad state');
      }
      return payload.callbackUrl.trim();
    } catch {
      throw new BadRequestException('Google sign-in expired. Please try again.');
    }
  }

  private async ensureSettings(userId: IUser['_id']) {
    const existing = await UserSettings.findOne({ userId });
    if (!existing) await UserSettings.create({ userId });
  }

  private googleConfigured(): boolean {
    return Boolean(
      this.config.get<string>('GOOGLE_CLIENT_ID') &&
        this.config.get<string>('GOOGLE_CLIENT_SECRET'),
    );
  }

  authProviders() {
    return {
      email: true,
      google: this.googleConfigured(),
      // Expo Go Apple Sign In verifies against host.exp.Exponent — no Apple key required for testing
      apple: true,
      note: 'Email always works. Google needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. Apple works on iOS via Expo Go.',
    };
  }

  async register(body: { name: string; email: string; password: string }) {
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!name || name.length < 2) {
      throw new BadRequestException('Name must be at least 2 characters');
    }
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Valid email required');
    }
    if (!password || password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const existing = await User.findOne({ email });
    if (existing) {
      throw new BadRequestException('Email already registered');
    }

    const user = await User.create({
      name,
      email,
      password,
      isVerified: true,
      authProvider: 'local',
    });

    await this.ensureSettings(user._id);

    const token = this.signToken(String(user._id));
    return {
      status: 'success',
      token,
      data: { user: publicUser(user) },
    };
  }

  async login(body: { email: string; password: string }) {
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!email || !password) {
      throw new BadRequestException('Email and password required');
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.authProvider !== 'local') {
      throw new UnauthorizedException(
        `This account uses ${user.authProvider} sign-in. Use that button instead.`,
      );
    }
    if (!user.isVerified) {
      throw new UnauthorizedException('Please verify your email before logging in.');
    }

    const token = this.signToken(String(user._id));
    return {
      status: 'success',
      token,
      data: { user: publicUser(user) },
    };
  }

  async profile(user: IUser) {
    return {
      status: 'success',
      data: { user: publicUser(user) },
    };
  }

  /** GET /auth/google?callback=exp://... — starts browser OAuth (Expo Go). */
  startGoogleOAuth(callbackUrl: string): string {
    if (!this.googleConfigured()) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
      );
    }
    if (!callbackUrl?.trim()) {
      throw new BadRequestException('callback parameter is required');
    }
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')!;
    const redirectUri = this.googleRedirectUri();
    const state = this.encodeGoogleState(callbackUrl.trim());
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async finishGoogleOAuth(code: string, state: string): Promise<{ redirectUrl: string }> {
    const appCallbackUrl = this.decodeGoogleState(state);

    try {
      const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')!;
      const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET')!;
      const redirectUri = this.googleRedirectUri();

      const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens.id_token) {
        return {
          redirectUrl: `${appCallbackUrl}?error=${encodeURIComponent('No ID token from Google')}`,
        };
      }

      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) {
        return {
          redirectUrl: `${appCallbackUrl}?error=${encodeURIComponent('Invalid Google token')}`,
        };
      }

      const googleId = payload.sub;
      const email = payload.email.toLowerCase();
      const name = payload.name || email.split('@')[0];

      let user = await User.findOne({
        $or: [{ googleId }, { email }],
      });

      if (user) {
        if (user.authProvider !== 'google') {
          return {
            redirectUrl: `${appCallbackUrl}?error=${encodeURIComponent(
              'Email already registered with password. Use email login.',
            )}`,
          };
        }
        if (!user.googleId) {
          user.googleId = googleId;
          await user.save();
        }
      } else {
        user = await User.create({
          name,
          email,
          googleId,
          authProvider: 'google',
          isVerified: true,
        });
        await this.ensureSettings(user._id);
      }

      const token = this.signToken(String(user._id));
      return { redirectUrl: `${appCallbackUrl}?token=${token}` };
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Google OAuth failed';
      const message = /redirect_uri/i.test(raw)
        ? 'Google redirect URI mismatch. Try again, or use email login.'
        : /invalid_grant/i.test(raw)
          ? 'Google sign-in expired. Please try again.'
          : 'Google sign-in failed. Use email login or try again.';
      return {
        redirectUrl: `${appCallbackUrl}?error=${encodeURIComponent(message)}`,
      };
    }
  }

  async appleLogin(body: {
    identityToken: string;
    user?: {
      fullName?: { givenName?: string | null; familyName?: string | null };
      email?: string | null;
    };
  }) {
    const identityToken = body.identityToken;
    if (!identityToken) {
      throw new BadRequestException('Identity token required');
    }

    const audiences = [
      this.config.get<string>('APPLE_CLIENT_ID'),
      'host.exp.Exponent',
    ].filter(Boolean) as string[];

    let appleIdToken: { sub: string; email?: string };
    try {
      appleIdToken = await appleSignin.verifyIdToken(identityToken, {
        audience: audiences.length ? audiences : undefined,
        ignoreExpiration: false,
      });
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Invalid Apple token',
      );
    }

    const appleId = appleIdToken.sub;
    const email =
      (appleIdToken.email || body.user?.email || `${appleId}@privaterelay.appleid.com`)
        .toLowerCase();

    let user = await User.findOne({
      $or: [{ appleId }, { email }],
    });

    if (user) {
      if (user.authProvider !== 'apple') {
        throw new BadRequestException(
          'Email already registered with another method. Use that sign-in instead.',
        );
      }
    } else {
      const given = body.user?.fullName?.givenName || '';
      const family = body.user?.fullName?.familyName || '';
      const name =
        `${given} ${family}`.trim() || email.split('@')[0] || 'Apple User';
      user = await User.create({
        name,
        email,
        appleId,
        authProvider: 'apple',
        isVerified: true,
      });
      await this.ensureSettings(user._id);
    }

    const token = this.signToken(String(user._id));
    return {
      status: 'success',
      token,
      data: { user: publicUser(user) },
    };
  }
}
