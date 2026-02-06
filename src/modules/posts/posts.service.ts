import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PrismaService } from 'src/database/prisma.service';
import { UserRole } from '@prisma/client';

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

  async update(id: string, user: { sub: string, role: UserRole }, updatePostDto: UpdatePostDto) {
    const post = await this.prismaService.post.findUnique({
      where: { id },
    });

    if (!post) throw new NotFoundException('Post không tồn tại');

    if (post.userId !== user.sub && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('Không có quyền cập nhật post này');

    return this.prismaService.post.update({
      where: { id },
      data: updatePostDto,
    });
  }

  async remove(id: string, user: { sub: string, role: UserRole }) {
    const post = await this.prismaService.post.findUnique({
      where: { id },
    });

    if (!post) throw new NotFoundException('Post không tồn tại');

    if (post.userId !== user.sub && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('Không có quyền cập nhật post này');

    return this.prismaService.post.delete({
      where: { id },
    });
  }
}
