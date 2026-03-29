import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/infra/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        avatarUrl: true,
        bio: true,
        role: true,
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
        jobs: {
          orderBy: { createdAt: 'desc' },
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
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      role: user.role,
      createdAt: user.createdAt,
      credits: user.credits,
      counts: {
        followers: user._count.followers,
        following: user._count.following,
        posts: user._count.posts,
        jobs: user._count.jobs,
      },
      jobs: user.jobs,
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

  remove(id: string) {
    return this.prismaService.user.delete({
      where: { id },
    });
  }
}
