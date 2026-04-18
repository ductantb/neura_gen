import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Profile,
  Strategy,
  VerifyCallback,
} from 'passport-google-oauth20';

export type GoogleProfilePayload = {
  googleId: string;
  email: string;
  username: string;
  avatarUrl?: string;
};

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const clientSecret = configService
      .get<string>('GOOGLE_CLIENT_SECRET')
      ?.trim();
    const callbackURL = configService
      .get<string>('GOOGLE_CALLBACK_URL')
      ?.trim();

    const enabled = Boolean(clientID && clientSecret && callbackURL);

    super({
      clientID: clientID || 'oauth-disabled-client-id',
      clientSecret: clientSecret || 'oauth-disabled-client-secret',
      callbackURL: callbackURL || 'http://localhost:3000/auth/google/callback',
      scope: ['email', 'profile'],
    });

    this.enabled = enabled;
    if (!this.enabled) {
      this.logger.warn(
        'Google OAuth2 is disabled. Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_CALLBACK_URL to enable.',
      );
    }
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    if (!this.enabled) {
      return done(new UnauthorizedException('Google OAuth2 is not configured'), false);
    }

    const email = profile.emails?.[0]?.value?.trim().toLowerCase();

    if (!email) {
      return done(
        new UnauthorizedException('Google account has no email address'),
        false,
      );
    }

    const payload: GoogleProfilePayload = {
      googleId: profile.id,
      email,
      username:
        profile.displayName?.trim() ||
        email.split('@')[0] ||
        `google_${profile.id.slice(0, 8)}`,
      avatarUrl: profile.photos?.[0]?.value,
    };

    done(null, payload);
  }
}
