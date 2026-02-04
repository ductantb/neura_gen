import { Injectable } from '@nestjs/common';
import { CreatePostLikeDto } from './dto/create-post-like.dto';
import { PrismaService } from 'src/database/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class PostLikesService {
  constructor(private readonly prismaService: PrismaService) {}

  create(createPostLikeDto: CreatePostLikeDto) {
    return this.prismaService.postLike.create({
      data: createPostLikeDto,
    });
  }

  async findUsers(postId: string, { cursor, take }: PaginationDto) {
    const postLikes = await this.prismaService.postLike.findMany({
      where: { postId },
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
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
    const hasNext = postLikes.length > take;
    if (hasNext) postLikes.pop();
    return {
      data: postLikes,
      nextCursor: hasNext ? postLikes[postLikes.length - 1].id : null,
    };
  }

  remove(userId: string, postId: string) {
    return this.prismaService.postLike.delete({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
    });
  }
}
