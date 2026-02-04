import { Injectable } from '@nestjs/common';
import { CreateFollowDto } from './dto/create-follow.dto';
import { PrismaService } from 'src/database/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class FollowsService {

  constructor(private readonly prismaService: PrismaService) {}

  create(createFollowDto: CreateFollowDto) {
    return this.prismaService.follow.create({
      data: createFollowDto,
    });
  }

  async findUsers(userId: string, { cursor, take }: PaginationDto) {
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

  remove(followerId: string, followingId: string) {
    return this.prismaService.follow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });
  }
}
