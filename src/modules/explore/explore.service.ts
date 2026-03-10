import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { ExploreQueryDto } from './dto/explore-query.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ExploreService {
  constructor(private readonly prismaService: PrismaService) {}

  async getExplore(query: ExploreQueryDto) {
    const { topic, trending, sort = 'score', limit = 20, cursor } = query;

    const where: Prisma.ExploreItemWhereInput = {
      ...(topic && { topic }),
      ...(trending && { isTrending: trending === 'true' }),
      post: {
        isPublic: true,
      },
    };

    return this.prismaService.exploreItem.findMany({
      where,
      take: limit,
      skip: cursor ? 1 : 0,
      ...(cursor && { cursor: { id: cursor } }),
      orderBy: sort === 'newest' ? { createdAt: 'desc' } : { score: 'desc' },
      include: {
        assetVersion: {
          include: {
            asset: true,
          },
        },
        post: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
  }
}
