import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateGalleryDto } from './dto/create-gallery.dto';
import { UpdateGalleryDto } from './dto/update-gallery.dto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class GalleryService {
  constructor(private readonly prismaService: PrismaService) {}

  create(userId: string, createGalleryDto: CreateGalleryDto) {
    return this.prismaService.galleryItem.create({
      data: {
        ...createGalleryDto,
        userId,
      },
    });
  }

  findAll(userId: string) {
    return this.prismaService.galleryItem.findMany({
      where: {
        userId,
      },
      select: {
        assetVersion: true,
        createdAt: true,
        isPublic: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, userId: string, updateGalleryDto: UpdateGalleryDto) {
    const galleryItem = await this.prismaService.galleryItem.findUnique({
      where: { id },
    });

    if (!galleryItem) throw new NotFoundException('Gallery item không tồn tại');

    if (galleryItem.userId !== userId)
      throw new ForbiddenException('Không có quyền cập nhật gallery item này');

    return this.prismaService.galleryItem.update({
      where: { id },
      data: updateGalleryDto,
    });
  }

  async remove(id: string, userId: string) {
    const galleryItem = await this.prismaService.galleryItem.findUnique({
      where: { id },
    });

    if (!galleryItem) throw new NotFoundException('Gallery item không tồn tại');

    if (galleryItem.userId !== userId)
      throw new ForbiddenException('Không có quyền xóa gallery item này');

    return this.prismaService.galleryItem.delete({
      where: { id },
    });
  }
}
