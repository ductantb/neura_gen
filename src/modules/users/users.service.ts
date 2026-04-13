import { CreditReason } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { TopUpCreditDto } from './dto/top-up-credit.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async getProfile(userId: string, { cursor, take = 20 }: PaginationDto) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        avatarUrl: true,
        bio: true,
        role: true,
        proExpiresAt: true,
        createdAt: true,
        credits: {
          select: {
            balance: true,
            updatedAt: true,
          },
        },
        _count: {
          select: {
            followers: true,
            following: true,
            posts: true,
            jobs: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const jobs = await this.prismaService.generateJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        prompt: true,
        negativePrompt: true,
        modelName: true,
        turboEnabled: true,
        creditCost: true,
        provider: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        failedAt: true,
      },
    });

    const hasNext = jobs.length > take;
    if (hasNext) jobs.pop();

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      role: user.role,
      proExpiresAt: user.proExpiresAt,
      createdAt: user.createdAt,
      credits: user.credits,
      counts: {
        followers: user._count.followers,
        following: user._count.following,
        posts: user._count.posts,
        jobs: user._count.jobs,
      },
      jobs: {
        data: jobs,
        nextCursor: hasNext ? jobs[jobs.length - 1].id : null,
        take,
      },
    };
  }

  findOne(id: string) {
    return this.prismaService.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        bio: true,
        credits: {
          select: {balance: true, updatedAt: true},
        }
      },
    });
  }

  update(userId: string, dto: UpdateUserDto) {
    return this.prismaService.user.update({
      where: { id: userId },
      data: dto,
    });
  }

  async topUpMyCredits(userId: string, dto: TopUpCreditDto) {
    return this.prismaService.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const wallet = await tx.userCredit.upsert({
        where: { userId },
        update: {
          balance: {
            increment: dto.amount,
          },
        },
        create: {
          userId,
          balance: dto.amount,
        },
      });

      const transaction = await tx.creditTransaction.create({
        data: {
          userId,
          amount: dto.amount,
          reason: CreditReason.TEST_REWARD,
          metadata: {
            source: 'manual_test_topup_api',
            note: dto.note ?? null,
          },
        },
      });

      return {
        userId,
        amount: dto.amount,
        balance: wallet.balance,
        reason: transaction.reason,
        transactionId: transaction.id,
        note: dto.note ?? null,
        createdAt: transaction.createdAt,
      };
    });
  }

  remove(id: string) {
    return this.prismaService.user.delete({
      where: { id },
    });
  }
}
