import {
  ConflictException,
  ForbiddenException,
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

type RefreshTokenPayload = {
  sub: string;
  email: string;
  username: string;
  role: UserRole;
  sid: string;
  type: 'refresh';
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async register(email: string, password: string): Promise<AuthResponseDto> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashed = await hashPassword(password);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        username: email.split('@')[0],
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

    await this.mailService.sendWelcomeEmail(user.email);
    return this.issueTokenPair(user);
  }

  async login(email: string, password: string): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email },
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
    const normalizedEmail = profile.email.trim().toLowerCase();

    const existingByGoogleId = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });

    if (existingByGoogleId) {
      return this.issueTokenPair(existingByGoogleId);
    }

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingByEmail) {
      const linkedUser = await this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          googleId: profile.googleId,
          ...(profile.avatarUrl && !existingByEmail.avatarUrl
            ? { avatarUrl: profile.avatarUrl }
            : {}),
        },
      });

      return this.issueTokenPair(linkedUser);
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

    await this.mailService.sendWelcomeEmail(newUser.email);
    return this.issueTokenPair(newUser);
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

    await this.mailService.sendPasswordChangedEmail(user.email);
    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const genericMessage =
      'If this email exists in our system, a password reset link has been sent.';

    const user = await this.prisma.user.findUnique({
      where: { email },
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

    await this.mailService.sendPasswordResetEmail(user.email, resetToken);

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
          },
        },
      },
    });

    if (!tokenRecord || tokenRecord.usedAt || tokenRecord.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException('Reset token is invalid or expired');
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

    await this.mailService.sendPasswordChangedEmail(tokenRecord.user.email);
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
}
