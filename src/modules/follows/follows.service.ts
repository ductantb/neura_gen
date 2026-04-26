import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateFollowDto } from './dto/create-follow.dto';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { UserRole } from '@prisma/client';
import { ExploreService } from '../explore/explore.service';

@Injectable()
export class FollowsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly exploreService: ExploreService,
  ) {}

  async create(userId: string, createFollowDto: CreateFollowDto) {
    const follow = await this.prismaService.follow.create({
      data: {
        followingId: createFollowDto.followingId,
        followerId: userId,
      },
    });

    if (createFollowDto.sourcePostId) {
      const sourcePost = await this.prismaService.post.findUnique({
        where: { id: createFollowDto.sourcePostId },
        select: {
          id: true,
          userId: true,
          isPublic: true,
        },
      });

      if (
        sourcePost &&
        sourcePost.isPublic &&
        sourcePost.userId === createFollowDto.followingId
      ) {
        await this.exploreService.recordEvent(userId, {
          postId: sourcePost.id,
          eventType: 'FOLLOW_CREATOR',
          metadata: {
            source: 'follow_action',
          },
        });
      }
    }

    return follow;
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
    });
  }
}
