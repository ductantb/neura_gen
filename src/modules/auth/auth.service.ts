import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { hashPassword, comparePassword } from '../../utils/hash';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ChangePasswordResponseDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(email: string, password: string): Promise<AuthResponseDto> {
    const hashed = await hashPassword(password);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        username: email.split('@')[0],
        credits: {
          create: {
            balance: 100, // default credits for new users
          }
        },
        creditTransactions: {
        create: {
          amount: 100,
          reason: 'REGISTER_BONUS',
        },
      },
      },
    });

    return {
      userId: user.id,
      email: user.email,
      username: user.username,
      accessToken: this.jwtService.sign({
        sub: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      }),
    };
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

    const payload: JwtPayload = {
      //userId: user.id,
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      accessToken: this.jwtService.sign(payload),
    };
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

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return { message: 'Password changed successfully' };
  }
}
