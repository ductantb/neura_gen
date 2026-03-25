import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

import { hashPassword, comparePassword } from '../../utils/hash';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChangePasswordResponseDto } from './dto/change-password.dto';
import { User, UserRole } from '@prisma/client';
import { StringValue } from 'ms';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
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
      select: { password: true },
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
    ]);

    return { message: 'Password changed successfully' };
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
}