import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class FollowsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(userId: string, followingId: string) {
    if (userId === followingId)
      throw new ForbiddenException('Không thể follow chính mình');

    const existing = await this.prismaService.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: userId,
          followingId,
        },
      },
    });

    if (existing) return { id: existing.id };

    return this.prismaService.follow.create({
      data: {
        followerId: userId,
        followingId,
      },
      select: {
        id: true,
      },
    });
  }

  async findFollowers(userId: string, { cursor, take }: PaginationDto) {
    const follows = await this.prismaService.follow.findMany({
      where: { followingId: userId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor && {
        cursor: {
          id: cursor,
        },
        skip: 1,
      }),
      select: {
        id: true,
        follower: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
    const hasNext = follows.length > take;
    if (hasNext) follows.pop();
    return {
      data: follows,
      nextCursor: hasNext ? follows[follows.length - 1].id : null,
    };
  }

  async findFollowings(userId: string, { cursor, take }: PaginationDto) {
    const follows = await this.prismaService.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor && {
        cursor: {
          id: cursor,
        },
        skip: 1,
      }),
      select: {
        id: true,
        following: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
    const hasNext = follows.length > take;
    if (hasNext) follows.pop();
    return {
      data: follows,
      nextCursor: hasNext ? follows[follows.length - 1].id : null,
    };
  }

  async remove(user: { followerId: string, role: UserRole }, followingId: string) {
    const follow = await this.prismaService.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: user.followerId,
          followingId,
        },
      },
    });

    if (!follow) throw new NotFoundException('Follow không tồn tại');

    if (follow.followerId !== user.followerId && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('Không có quyền xoá follow này');

    return this.prismaService.follow.delete({
      where: {
        followerId_followingId: {
          followerId: user.followerId,
          followingId,
        },
      },
      select: {
        id: true,
      },
    });
  }
}
