import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { PrismaService } from 'src/database/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class CommentsService {
  constructor(private readonly prismaService: PrismaService) {}

  create(userId: string, createCommentDto: CreateCommentDto) {
    return this.prismaService.$transaction(async (prisma) => {
      await prisma.post.update({
        where: { id: createCommentDto.postId },
        data: { commentCount: { increment: 1 } },
      });
      return prisma.comment.create({
        data: {
          ...createCommentDto,
          userId,
        },
      });
    });
  }

  async findComments(postId: string, { cursor, take = 20 }: PaginationDto) {
    const comments = await this.prismaService.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    const hasNext = comments.length > take;
    if (hasNext) comments.pop();

    return {
      data: comments,
      nextCursor: hasNext ? comments[comments.length - 1].id : null,
    };
  }

  async update(id: string, user: { sub: string, role: UserRole }, dto: UpdateCommentDto) {
    const comment = await this.prismaService.comment.findUnique({
      where: { id },
    });

    if (!comment) {
      throw new NotFoundException('Comment không tồn tại');
    }

    if (comment.userId !== user.sub && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Không có quyền sửa comment này');
    }

    return this.prismaService.comment.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, user: { sub: string, role: UserRole }) {
    const comment = await this.prismaService.comment.findUnique({
      where: { id },
    });

    if (!comment) {
      throw new NotFoundException('Comment không tồn tại');
    }

    if (comment.userId !== user.sub && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Không có quyền xoá comment này');
    }

    return this.prismaService.$transaction(async (prisma) => {
      await prisma.post.update({
        where: { id: comment.postId },
        data: { commentCount: { decrement: 1 } },
      });
      return prisma.comment.delete({
        where: { id },
      });
    });
  }
}
