import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostLikeDto } from './dto/create-post-like.dto';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { UserRole } from '@prisma/client';
import { ExploreService } from '../explore/explore.service';

@Injectable()
export class PostLikesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly exploreService: ExploreService,
  ) {}

  async create(
    userId: string,
    createPostLikeDto: CreatePostLikeDto & { postId: string },
  ) {
    const postLike = await this.prismaService.$transaction(async (prisma) => {
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

    await this.exploreService.syncPost(createPostLikeDto.postId);
    return postLike;
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

    const deleted = await this.prismaService.$transaction(async (prisma) => {
      const deleted = await prisma.postLike.delete({
        where: {
          userId_postId: {
            userId: user.sub,
            postId,
          },
        },
      });

      await prisma.post.update({
        where: { id: postId },
        data: {
          likeCount: {
            decrement: 1,
          },
        },
      });

      return deleted;
    });

    await this.exploreService.syncPost(postId);
    return deleted;
  }
}
