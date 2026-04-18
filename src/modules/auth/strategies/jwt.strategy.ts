import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        proExpiresAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    let effectiveRole = user.role;
    if (
      user.role === UserRole.PRO &&
      (!user.proExpiresAt || user.proExpiresAt.getTime() <= Date.now())
    ) {
      const downgradedUser = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          role: UserRole.FREE,
          proExpiresAt: null,
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
        },
      });

      return {
        id: downgradedUser.id,
        sub: downgradedUser.id,
        email: downgradedUser.email,
        username: downgradedUser.username,
        role: downgradedUser.role,
        sid: payload.sid,
      };
    }

    return {
      id: user.id,
      sub: user.id,
      email: user.email,
      username: user.username,
      role: effectiveRole,
      sid: payload.sid,
    };
  }
}
