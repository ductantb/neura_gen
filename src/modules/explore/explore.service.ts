import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { ExploreQueryDto } from './dto/explore-query.dto';

type ExploreMode = 'trending' | 'new' | 'top';

@Injectable()
export class ExploreService {
  private readonly logger = new Logger(ExploreService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async getExplore(query: ExploreQueryDto) {
    const {
      topic,
      trending,
      sort,
      mode = 'trending',
      limit = 20,
      cursor,
    } = query;

    const resolvedMode = this.resolveMode(mode, sort);

    const where: Prisma.ExploreItemWhereInput = {
      ...(topic && { topic: topic.trim().toLowerCase() }),
      ...(trending && { isTrending: trending === 'true' }),
      ...(resolvedMode === 'trending' && !trending && { isTrending: true }),
      post: {
        isPublic: true,
      },
    };

    const items = await this.prismaService.exploreItem.findMany({
      where,
      take: limit + 1,
      skip: cursor ? 1 : 0,
      ...(cursor && { cursor: { id: cursor } }),
      orderBy: this.buildOrderBy(resolvedMode, sort),
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

    const hasNext = items.length > limit;
    if (hasNext) items.pop();

    return {
      mode: resolvedMode,
      data: items,
      nextCursor: hasNext ? items[items.length - 1].id : null,
      limit,
    };
  }

  async syncPost(postId: string) {
    const post = await this.prismaService.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        assetVersionId: true,
        caption: true,
        isPublic: true,
        createdAt: true,
        likeCount: true,
        commentCount: true,
        viewCount: true,
      },
    });

    if (!post) {
      return;
    }

    if (!post.isPublic) {
      await this.prismaService.exploreItem.deleteMany({
        where: { postId: post.id },
      });
      return;
    }

    const score = this.calculateScore(post);

    await this.prismaService.exploreItem.upsert({
      where: { postId: post.id },
      update: {
        assetVersionId: post.assetVersionId,
        title: this.extractTitle(post.caption),
        topic: this.extractTopic(post.caption),
        score,
        isTrending: this.computeTrendingFlag(post.createdAt, score),
      },
      create: {
        postId: post.id,
        assetVersionId: post.assetVersionId,
        title: this.extractTitle(post.caption),
        topic: this.extractTopic(post.caption),
        score,
        isTrending: this.computeTrendingFlag(post.createdAt, score),
      },
    });
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async refreshExploreScores() {
    const publicPosts = await this.prismaService.post.findMany({
      where: { isPublic: true },
      select: { id: true },
    });

    if (publicPosts.length === 0) {
      return;
    }

    await Promise.all(publicPosts.map((post) => this.syncPost(post.id)));

    await this.prismaService.exploreItem.deleteMany({
      where: {
        post: {
          isPublic: false,
        },
      },
    });

    this.logger.debug(`Explore scores refreshed for ${publicPosts.length} posts`);
  }

  private resolveMode(
    mode: ExploreMode,
    sort?: ExploreQueryDto['sort'],
  ): ExploreMode {
    if (sort === 'newest') return 'new';
    if (sort === 'score') return mode === 'new' ? 'new' : 'top';
    return mode;
  }

  private buildOrderBy(
    mode: ExploreMode,
    sort?: ExploreQueryDto['sort'],
  ): Prisma.ExploreItemOrderByWithRelationInput[] {
    if (sort === 'newest' || mode === 'new') {
      return [{ createdAt: 'desc' }, { score: 'desc' }];
    }
    return [{ score: 'desc' }, { createdAt: 'desc' }];
  }

  private calculateScore(post: {
    createdAt: Date;
    likeCount: number;
    commentCount: number;
    viewCount: number;
  }) {
    const ageHours = (Date.now() - post.createdAt.getTime()) / 3_600_000;
    const likes = post.likeCount ?? 0;
    const comments = post.commentCount ?? 0;
    const views = post.viewCount ?? 0;

    const engagementScore = likes * 3 + comments * 4 + Math.log1p(views) * 2;
    const qualityRate = (likes + comments * 2) / Math.max(views, 20);
    const qualityBoost = Math.min(8, qualityRate * 40);
    const freshnessBoost = Math.max(0, 24 - ageHours) * 0.35;
    const coldStartBoost =
      ageHours <= 2 ? 10 : ageHours <= 12 ? 6 : ageHours <= 24 ? 3 : 0;
    const decay = ageHours * 0.15;

    return Math.max(
      0,
      Number(
        (
          engagementScore +
          qualityBoost +
          freshnessBoost +
          coldStartBoost -
          decay
        ).toFixed(4),
      ),
    );
  }

  private computeTrendingFlag(createdAt: Date, score: number) {
    const ageHours = (Date.now() - createdAt.getTime()) / 3_600_000;
    return ageHours <= 72 && score >= 14;
  }

  private extractTitle(caption?: string | null) {
    const normalized = (caption ?? '').trim();
    if (!normalized) return 'Untitled creation';
    return normalized.slice(0, 100);
  }

  private extractTopic(caption?: string | null) {
    const normalized = (caption ?? '').trim().toLowerCase();
    if (!normalized) return 'general';

    const hashtag = normalized.match(/#([a-z0-9_-]+)/);
    if (hashtag?.[1]) return hashtag[1];

    if (/(anime|manga|otaku)/.test(normalized)) return 'anime';
    if (/(cinematic|movie|film)/.test(normalized)) return 'cinematic';
    if (/(portrait|face|selfie)/.test(normalized)) return 'portrait';
    if (/(landscape|nature|forest|mountain)/.test(normalized))
      return 'landscape';
    if (/(scifi|sci-fi|cyberpunk|future)/.test(normalized)) return 'scifi';

    return 'general';
  }
}
