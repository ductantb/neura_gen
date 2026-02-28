import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostLikeDto } from './dto/create-post-like.dto';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class PostLikesService {
  constructor(private readonly prismaService: PrismaService) {}

  create(userId: string, createPostLikeDto: CreatePostLikeDto) {
    return this.prismaService.$transaction(async (prisma) => {
      const postLike = await prisma.postLike.create({
        data: {
          ...createPostLikeDto,
          userId,
        },
      });
      await prisma.post.update({
        where: { id: createPostLikeDto.postId },
        data: { likeCount: { increment: 1 } },
      });
      return postLike;
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

  async remove(postId: string, user: { sub: string, role: UserRole }) {
    const postLike = await this.prismaService.postLike.findUnique({
      where: {
        userId_postId: {
          userId: user.sub,
          postId,
        },
      },
    });

    if (!postLike) throw new NotFoundException('Post like không tồn tại');

    if (postLike.userId !== user.sub && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('Không có quyền xoá post like này');

    return this.prismaService.postLike.delete({
      where: {
        userId_postId: {
          userId: user.sub,
          postId,
        },
      },
    });
  }
}
