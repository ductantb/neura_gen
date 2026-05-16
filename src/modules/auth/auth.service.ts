import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';

import { hashPassword, comparePassword } from '../../utils/hash';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChangePasswordResponseDto } from './dto/change-password.dto';
import { User, UserRole } from '@prisma/client';
import { StringValue } from 'ms';
import { MailService } from 'src/infra/mail/mail.service';
import { GoogleProfilePayload } from './strategies/google.strategy';
import { REDIS_CLIENT } from 'src/common/constants';
import Redis from 'ioredis';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

type RefreshTokenPayload = {
  sub: string;
  email: string;
  username: string;
  role: UserRole;
  sid: string;
  type: 'refresh';
};

type GoogleOauthStatePayload = {
  type: 'google_oauth_state';
  nonce: string;
  intent?: 'login' | 'register';
  redirectUri?: string;
  platform?: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async register(email: string, password: string): Promise<AuthResponseDto> {
    const normalizedEmail = this.normalizeEmail(email);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashed = await hashPassword(password);

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashed,
        username: normalizedEmail.split('@')[0],
        credits: {
          create: {
            balance: 100,
          },
        },
        creditTransactions: {
          create: {
            amount: 100,
            reason: 'REGISTER_BONUS',
          },
        },
      },
    });

    this.dispatchEmail('welcome_email', user.email, () =>
      this.mailService.sendWelcomeEmail(user.email),
    );
    return this.issueTokenPair(user);
  }

  async login(email: string, password: string): Promise<AuthResponseDto> {
    const normalizedEmail = this.normalizeEmail(email);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokenPair(user);
  }

  async loginWithGoogle(profile: GoogleProfilePayload): Promise<AuthResponseDto> {
    const existingByGoogleId = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });

    if (existingByGoogleId) {
      return this.issueTokenPair(existingByGoogleId);
    }

    const normalizedEmail = this.normalizeEmail(profile.email);
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingByEmail) {
      throw new UnauthorizedException(
        'Google account is not linked. Please login with password and link Google first.',
      );
    }

    // First-time Google login: auto create account and issue tokens.
    return this.registerWithGoogle(profile);
  }

  async registerWithGoogle(profile: GoogleProfilePayload): Promise<AuthResponseDto> {
    const normalizedEmail = this.normalizeEmail(profile.email);

    const existingByGoogleId = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
      select: { id: true },
    });

    if (existingByGoogleId) {
      throw new ConflictException('Google account already exists');
    }

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingByEmail) {
      throw new ConflictException('Email already exists');
    }

    const randomPassword = randomBytes(32).toString('hex');
    const hashed = await hashPassword(randomPassword);

    const newUser = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        googleId: profile.googleId,
        password: hashed,
        username: profile.username,
        avatarUrl: profile.avatarUrl,
        credits: {
          create: {
            balance: 100,
          },
        },
        creditTransactions: {
          create: {
            amount: 100,
            reason: 'REGISTER_BONUS',
          },
        },
      },
    });

    this.dispatchEmail('welcome_email', newUser.email, () =>
      this.mailService.sendWelcomeEmail(newUser.email),
    );
    return this.issueTokenPair(newUser);
  }

  async loginWithGoogleIdToken(
    idToken: string,
    platform?: string,
  ): Promise<AuthResponseDto> {
    const profile = await this.resolveGoogleProfileFromIdToken(idToken);

    if (platform) {
      this.logger.debug(`Google ID token login platform=${platform}`);
    }

    return this.loginWithGoogle(profile);
  }

  async registerWithGoogleIdToken(
    idToken: string,
    platform?: string,
  ): Promise<AuthResponseDto> {
    const profile = await this.resolveGoogleProfileFromIdToken(idToken);

    if (platform) {
      this.logger.debug(`Google ID token register platform=${platform}`);
    }

    return this.registerWithGoogle(profile);
  }

  async linkGoogleAccountByIdToken(
    userId: string,
    idToken: string,
    platform?: string,
  ): Promise<{ message: string }> {
    const profile = await this.resolveGoogleProfileFromIdToken(idToken);
    return this.linkGoogleAccount(userId, profile, platform);
  }

  async linkGoogleAccount(
    userId: string,
    profile: GoogleProfilePayload,
    platform?: string,
  ): Promise<{ message: string }> {
    if (platform) {
      this.logger.debug(`Google account link platform=${platform}`);
    }

    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        googleId: true,
        avatarUrl: true,
      },
    });

    if (!currentUser) {
      throw new UnauthorizedException('User not found');
    }

    if (currentUser.googleId) {
      if (currentUser.googleId === profile.googleId) {
        return { message: 'Google account already linked' };
      }
      throw new ConflictException('This account is already linked with another Google account');
    }

    const existingByGoogleId = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
      select: { id: true },
    });

    if (existingByGoogleId && existingByGoogleId.id !== userId) {
      throw new ConflictException('This Google account is already linked to another user');
    }

    const normalizedEmail = this.normalizeEmail(profile.email);
    if (normalizedEmail !== currentUser.email) {
      throw new BadRequestException(
        'Google email does not match current account email',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        googleId: profile.googleId,
        ...(profile.avatarUrl && !currentUser.avatarUrl
          ? { avatarUrl: profile.avatarUrl }
          : {}),
      },
    });

    return { message: 'Google account linked successfully' };
  }

  async buildGoogleOauthState(
    intent: 'login' | 'register',
    redirectUri?: string,
    platform?: string,
  ): Promise<string> {
    const safeRedirectUri = this.sanitizeRedirectUri(redirectUri);
    const payload: GoogleOauthStatePayload = {
      type: 'google_oauth_state',
      nonce: randomBytes(16).toString('hex'),
      intent,
      ...(safeRedirectUri ? { redirectUri: safeRedirectUri } : {}),
      ...(platform ? { platform: platform.trim().toLowerCase() } : {}),
    };

    return this.jwtService.signAsync(payload, {
      secret: this.getOauthStateSecret(),
      expiresIn: this.getOauthStateExpiresIn() as StringValue,
    });
  }

  async consumeGoogleOauthState(stateToken?: string): Promise<GoogleOauthStatePayload> {
    if (!stateToken) {
      throw new BadRequestException('Missing OAuth state');
    }

    let payload: GoogleOauthStatePayload;
    try {
      payload = await this.jwtService.verifyAsync<GoogleOauthStatePayload>(
        stateToken,
        {
          secret: this.getOauthStateSecret(),
        },
      );
    } catch {
      throw new ForbiddenException('OAuth state is invalid or expired');
    }

    if (payload.type !== 'google_oauth_state' || !payload.nonce) {
      throw new ForbiddenException('OAuth state payload is invalid');
    }

    const intent =
      payload.intent === 'register' || payload.intent === 'login'
        ? payload.intent
        : 'login';

    return {
      ...payload,
      intent,
      ...(payload.redirectUri
        ? { redirectUri: this.sanitizeRedirectUri(payload.redirectUri) }
        : {}),
    };
  }

  async createGoogleAuthCode(authResponse: AuthResponseDto): Promise<string> {
    const code = randomBytes(24).toString('hex');
    const key = this.getGoogleAuthCodeKey(code);
    const ttlSeconds = this.getGoogleAuthCodeTtlSeconds();
    const result = await this.redis.set(
      key,
      JSON.stringify(authResponse),
      'EX',
      ttlSeconds,
      'NX',
    );

    if (result !== 'OK') {
      throw new UnauthorizedException('Unable to issue OAuth auth code');
    }

    return code;
  }

  async exchangeGoogleAuthCode(code: string): Promise<AuthResponseDto> {
    const key = this.getGoogleAuthCodeKey(code);
    const raw = await this.redis.eval(
      "local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]); end; return v;",
      1,
      key,
    );

    if (!raw || typeof raw !== 'string') {
      throw new UnauthorizedException('Auth code is invalid or expired');
    }

    let parsed: AuthResponseDto;
    try {
      parsed = JSON.parse(raw) as AuthResponseDto;
    } catch {
      throw new UnauthorizedException('Auth code payload is malformed');
    }

    if (
      !parsed?.userId ||
      !parsed?.email ||
      !parsed?.username ||
      !parsed?.accessToken ||
      !parsed?.refreshToken
    ) {
      throw new UnauthorizedException('Auth code payload is invalid');
    }

    return parsed;
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      include: {
        user: true,
      },
    });

    if (!session || !session.user) {
      throw new UnauthorizedException('Refresh session not found');
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('Refresh session has been revoked');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    if (session.userId !== payload.sub) {
      throw new UnauthorizedException('Refresh token does not match session owner');
    }

    const isTokenMatch = await comparePassword(refreshToken, session.hashedToken);
    if (!isTokenMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(session.user, session.id);
    const hashedRefreshToken = await hashPassword(tokens.refreshToken);
    const refreshExpiresAt = this.computeExpiryDate(
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: {
        hashedToken: hashedRefreshToken,
        expiresAt: refreshExpiresAt,
        lastUsedAt: new Date(),
      },
    });

    return {
      userId: session.user.id,
      username: session.user.username,
      email: session.user.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async logout(userId: string, refreshToken: string): Promise<{ message: string }> {
    const payload = await this.verifyRefreshToken(refreshToken);

    if (payload.sub !== userId) {
      throw new ForbiddenException('Refresh token does not belong to current user');
    }

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
    });

    if (!session || session.userId !== userId) {
      throw new UnauthorizedException('Refresh session not found');
    }

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
      },
    });

    return { message: 'Logged out successfully' };
  }

  async logoutAll(userId: string): Promise<{ message: string }> {
    await this.prisma.refreshSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return { message: 'Logged out from all devices successfully' };
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, password: true },
    });

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const isMatch = await comparePassword(oldPassword, user.password);
    if (!isMatch) {
      throw new ForbiddenException('Old password is incorrect');
    }

    const isSamePassword = await comparePassword(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from old password',
      );
    }

    const hashed = await hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashed },
      }),
      this.prisma.refreshSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: { userId },
      }),
    ]);

    this.dispatchEmail('password_changed_email', user.email, () =>
      this.mailService.sendPasswordChangedEmail(user.email),
    );
    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const genericMessage =
      'If this email exists in our system, a password reset link has been sent.';
    const normalizedEmail = this.normalizeEmail(email);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true },
    });

    if (!user) {
      return { message: genericMessage };
    }

    const resetToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(resetToken);
    const ttlMinutes = this.getResetTokenTtlMinutes();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: user.id },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    this.dispatchEmail('password_reset_email', user.email, () =>
      this.mailService.sendPasswordResetEmail(user.email, resetToken),
    );

    return { message: genericMessage };
  }

  async resetPassword(
    resetToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const tokenHash = this.hashToken(resetToken);

    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });

    if (!tokenRecord || tokenRecord.usedAt || tokenRecord.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException('Reset token is invalid or expired');
    }

    const isSamePassword = await comparePassword(
      newPassword,
      tokenRecord.user.password,
    );
    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const hashedPassword = await hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.refreshSession.updateMany({
        where: {
          userId: tokenRecord.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { usedAt: new Date() },
      }),
    ]);

    this.dispatchEmail('password_changed_email', tokenRecord.user.email, () =>
      this.mailService.sendPasswordChangedEmail(tokenRecord.user.email),
    );
    return { message: 'Password reset successfully' };
  }

  private async issueTokenPair(user: User): Promise<AuthResponseDto> {
    const sessionId = randomUUID();

    const tokens = await this.generateTokens(user, sessionId);
    const hashedRefreshToken = await hashPassword(tokens.refreshToken);
    const refreshExpiresAt = this.computeExpiryDate(
      this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );

    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        hashedToken: hashedRefreshToken,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  private async generateTokens(user: User, sessionId: string) {
    const accessPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      sid: sessionId,
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      sid: sessionId,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN') as StringValue,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN') as StringValue,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  private async verifyRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        },
      );

      if (payload.type !== 'refresh' || !payload.sid) {
        throw new UnauthorizedException('Invalid refresh token payload');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private computeExpiryDate(expiresIn: string | number): Date {
    if (typeof expiresIn === 'number') {
      return new Date(Date.now() + expiresIn * 1000);
    }

    const value = expiresIn.trim().toLowerCase();
    const match = value.match(/^(\d+)([smhd])$/);

    if (!match) {
      throw new Error(`Unsupported expiresIn format: ${expiresIn}`);
    }

    const amount = Number(match[1]);
    const unit = match[2];

    const multiplier: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + amount * multiplier[unit]);
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getResetTokenTtlMinutes(): number {
    const rawValue =
      this.configService.get<string>('PASSWORD_RESET_TOKEN_TTL_MINUTES') ?? '15';
    const value = Number(rawValue);

    if (!Number.isFinite(value) || value <= 0) {
      this.logger.warn(
        `Invalid PASSWORD_RESET_TOKEN_TTL_MINUTES=${rawValue}. Fallback to 15.`,
      );
      return 15;
    }

    return value;
  }

  private getGoogleAudiences(): string[] {
    const audiences = new Set<string>();
    const primary = this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim();

    if (primary) {
      audiences.add(primary);
    }

    const extra = this.configService
      .get<string>('GOOGLE_ALLOWED_AUDIENCES')
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    extra?.forEach((value) => audiences.add(value));

    if (audiences.size === 0) {
      throw new UnauthorizedException('Google OAuth2 audiences are not configured');
    }

    return Array.from(audiences);
  }

  private getOauthStateSecret(): string {
    return (
      this.configService.get<string>('OAUTH_STATE_SECRET')?.trim() ||
      this.configService.getOrThrow<string>('JWT_ACCESS_SECRET')
    );
  }

  private getOauthStateExpiresIn(): string {
    return (
      this.configService.get<string>('OAUTH_STATE_EXPIRES_IN')?.trim() || '10m'
    );
  }

  private getGoogleAuthCodeTtlSeconds(): number {
    const raw = this.configService.get<string>('GOOGLE_AUTH_CODE_TTL_SECONDS') ?? '120';
    const ttl = Number(raw);
    if (!Number.isFinite(ttl) || ttl < 30) {
      return 120;
    }
    return Math.floor(ttl);
  }

  private getGoogleAuthCodeKey(code: string): string {
    return `auth:google:code:${this.hashToken(code)}`;
  }

  private async resolveGoogleProfileFromIdToken(
    idToken: string,
  ): Promise<GoogleProfilePayload> {
    let payload: TokenPayload | undefined;

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.getGoogleAudiences(),
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload?.sub || !payload?.email) {
      throw new UnauthorizedException('Google ID token payload is invalid');
    }

    if (payload.email_verified === false) {
      throw new UnauthorizedException('Google email is not verified');
    }

    return {
      googleId: payload.sub,
      email: this.normalizeEmail(payload.email),
      username: payload.name?.trim() || payload.email.split('@')[0],
      avatarUrl: payload.picture,
    };
  }

  private sanitizeRedirectUri(value?: string): string | undefined {
    if (!value) return undefined;

    const redirectUri = value.trim();
    if (!redirectUri) return undefined;

    const allowlist = this.getAllowedRedirectUris();
    const matched = allowlist.some((allowed) => redirectUri.startsWith(allowed));
    if (!matched) {
      this.logger.warn(`Blocked OAuth redirect URI: ${redirectUri}`);
      return undefined;
    }

    return redirectUri;
  }

  private getAllowedRedirectUris(): string[] {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.trim();
    const extra = this.configService
      .get<string>('OAUTH_ALLOWED_REDIRECT_URIS')
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    return [
      ...(frontendUrl ? [frontendUrl] : []),
      ...(extra ?? []),
    ];
  }

  private dispatchEmail(
    kind: string,
    email: string,
    send: () => Promise<boolean>,
  ): void {
    void send()
      .then((sent) => {
        if (!sent) {
          this.logger.warn(`${kind} was not delivered to ${email}`);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`${kind} failed for ${email}: ${message}`);
      });
  }
}
