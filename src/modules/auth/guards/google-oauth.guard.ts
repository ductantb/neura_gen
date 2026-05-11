import { ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { StringValue } from 'ms';

@Injectable()
export class GoogleOauthGuard extends AuthGuard('google') {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const clientSecret = this.configService
      .get<string>('GOOGLE_CLIENT_SECRET')
      ?.trim();
    const callbackUrl = this.configService
      .get<string>('GOOGLE_CALLBACK_URL')
      ?.trim();

    if (!clientId || !clientSecret || !callbackUrl) {
      throw new ServiceUnavailableException(
        'Google OAuth2 is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL.',
      );
    }

    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();

    if (req.path.endsWith('/callback')) {
      return { session: false };
    }

    const redirectUri =
      typeof req.query.redirectUri === 'string' ? req.query.redirectUri : undefined;
    const platform =
      typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const intent = this.resolveOauthIntent(req.path);

    const state = this.jwtService.sign(
      {
        type: 'google_oauth_state',
        nonce: randomBytes(16).toString('hex'),
        intent,
        ...(redirectUri ? { redirectUri } : {}),
        ...(platform ? { platform } : {}),
      },
      {
        secret:
          this.configService.get<string>('OAUTH_STATE_SECRET')?.trim() ||
          this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: (this.configService.get<string>('OAUTH_STATE_EXPIRES_IN') ||
          '10m') as StringValue,
      },
    );

    return {
      scope: ['email', 'profile'],
      prompt: 'select_account',
      session: false,
      state,
    };
  }

  private resolveOauthIntent(path: string): 'login' | 'register' {
    if (path.endsWith('/register')) {
      return 'register';
    }

    return 'login';
  }
}
