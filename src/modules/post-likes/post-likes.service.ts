import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class PostLikesService {
  constructor(private readonly prismaService: PrismaService) {}

  create(userId: string, postId: string) {
    return this.prismaService.$transaction(async (prisma) => {
      const postLike = await prisma.postLike.create({
        data: {
          userId,
          postId,
        },
        select: {
          id: true,
        },
      });
      await prisma.post.update({
        where: { id: postId },
        data: { likeCount: { increment: 1 } },
      });
      return postLike;
    });
  }

  async isLiked(postId: string, userId?: string) {
    if (!userId) return false;

    const count = await this.prismaService.postLike.count({
      where: {
        userId,
        postId,
      },
    });

    return count > 0;
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

  async remove(postId: string, user: { sub: string; role: UserRole }) {
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

    await this.prismaService.post.update({
      where: { id: postId },
      data: {
        likeCount: { decrement: 1 },
      },
    });

    return this.prismaService.postLike.delete({
      where: {
        userId_postId: {
          userId: user.sub,
          postId,
        },
      },
      select: {
        id: true,
      },
    });
  }
}
