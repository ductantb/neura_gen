import { Injectable } from '@nestjs/common';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { PrismaService } from 'src/database/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class CommentsService {
  constructor(private readonly prismaService: PrismaService) {}

  create(createCommentDto: CreateCommentDto) {
    return this.prismaService.comment.create({
      data: createCommentDto,
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

  update(id: string, updateCommentDto: UpdateCommentDto) {
    return this.prismaService.comment.update({
      where: { id },
      data: updateCommentDto,
    });
  }

  remove(id: string) {
    return this.prismaService.comment.delete({
      where: { id },
    });
  }
}
