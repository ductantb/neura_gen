import { Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class PostsService {
  constructor(private readonly prismaService: PrismaService) {}

  create(userId: string, createPostDto: CreatePostDto) {
    return this.prismaService.post.create({
      data: {
        ...createPostDto,
        userId,
      },
    });
  }

  findAll() {
    return this.prismaService.post.findMany();
  }

  findOne(id: string) {
    return this.prismaService.post.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        assetVersion: {
          select: {
            id: true,
            fileUrl: true,
            metadata: true,
          },
        },
      },
    });
  }

  async update(id: string, userId: string, updatePostDto: UpdatePostDto) {
    const post = await this.prismaService.post.findUnique({
      where: { id },
    });

    if (!post) throw new NotFoundException('Post không tồn tại');

    if (post.userId !== userId)
      throw new NotFoundException('Không có quyền cập nhật post này');

    return this.prismaService.post.update({
      where: { id },
      data: updatePostDto,
    });
  }

  remove(id: string) {

    return this.prismaService.post.delete({
      where: { id },
    });
  }
}
