import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExploreEventType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { ExploreQueryDto } from './dto/explore-query.dto';
import { RecordExploreEventDto } from './dto/record-explore-event.dto';
import { BatchRecordExploreEventsDto } from './dto/batch-record-explore-events.dto';

type ExploreMode = 'trending' | 'new' | 'top';

const EVENT_WEIGHTS: Record<ExploreEventType, number> = {
  IMPRESSION: 0.2,
  OPEN_POST: 1,
  WATCH_3S: 1.5,
  WATCH_50: 2.5,
  LIKE: 3,
  COMMENT: 4,
  FOLLOW_CREATOR: 3.5,
  HIDE: -8,
};

const EXPLORE_ITEM_INCLUDE = {
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
} satisfies Prisma.ExploreItemInclude;

type ExploreItemWithRelations = Prisma.ExploreItemGetPayload<{
  include: typeof EXPLORE_ITEM_INCLUDE;
}>;

type ExploreEventInput = Pick<
  RecordExploreEventDto,
  'postId' | 'eventType' | 'metadata'
>;

@Injectable()
export class ExploreService {
  private readonly logger = new Logger(ExploreService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async getExplore(query: ExploreQueryDto) {
    const { topic, trending, sort, mode, limit = 20, cursor } = query;

    const resolvedMode = this.resolvePublicMode(mode, sort);
    const normalizedTopic = topic?.trim().toLowerCase();

    const where: Prisma.ExploreItemWhereInput = {
      ...(normalizedTopic && { topic: normalizedTopic }),
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
      include: EXPLORE_ITEM_INCLUDE,
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

  async getForYou(userId: string, query: ExploreQueryDto) {
    const { topic, limit = 20, cursor } = query;
    const normalizedTopic = topic?.trim().toLowerCase();

    const [profiles, followings, hiddenRows] = await Promise.all([
      this.prismaService.userTopicProfile.findMany({
        where: { userId },
        orderBy: { score: 'desc' },
        take: 10,
        select: {
          topic: true,
          score: true,
          updatedAt: true,
        },
      }),
      this.prismaService.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      }),
      this.prismaService.hiddenPost.findMany({
        where: { userId },
        select: { postId: true },
      }),
    ]);

    if (profiles.length === 0 && followings.length === 0) {
      const fallback = await this.getExplore({
        ...query,
        mode: 'trending',
      });

      return {
        ...fallback,
        mode: 'for_you',
        fallback: 'trending',
      };
    }

    const hiddenPostIds = hiddenRows.map((row) => row.postId);
    const followingIds = followings.map((row) => row.followingId);
    const preferredTopics = profiles
      .filter((profile) => profile.score > 0)
      .map((profile) => profile.topic);

    const takeSize = Math.min(300, Math.max(limit * 10, 80));

    const [
      topicCandidates,
      followCandidates,
      trendingCandidates,
      freshCandidates,
    ] = await Promise.all([
      preferredTopics.length > 0
        ? this.prismaService.exploreItem.findMany({
            where: this.buildExploreWhere({
              normalizedTopic,
              topicsIn: preferredTopics,
              hiddenPostIds,
            }),
            orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
            take: takeSize,
            include: EXPLORE_ITEM_INCLUDE,
          })
        : Promise.resolve([] as ExploreItemWithRelations[]),
      followingIds.length > 0
        ? this.prismaService.exploreItem.findMany({
            where: this.buildExploreWhere({
              normalizedTopic,
              followingIds,
              hiddenPostIds,
            }),
            orderBy: [{ createdAt: 'desc' }, { score: 'desc' }],
            take: takeSize,
            include: EXPLORE_ITEM_INCLUDE,
          })
        : Promise.resolve([] as ExploreItemWithRelations[]),
      this.prismaService.exploreItem.findMany({
        where: this.buildExploreWhere({
          normalizedTopic,
          hiddenPostIds,
          trendingOnly: true,
        }),
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: takeSize,
        include: EXPLORE_ITEM_INCLUDE,
      }),
      this.prismaService.exploreItem.findMany({
        where: this.buildExploreWhere({
          normalizedTopic,
          hiddenPostIds,
        }),
        orderBy: [{ createdAt: 'desc' }],
        take: takeSize,
        include: EXPLORE_ITEM_INCLUDE,
      }),
    ]);

    const mergedItems = this.mergeById([
      ...topicCandidates,
      ...followCandidates,
      ...trendingCandidates,
      ...freshCandidates,
    ]);

    if (mergedItems.length === 0) {
      return {
        mode: 'for_you',
        data: [],
        nextCursor: null,
        limit,
      };
    }

    const candidatePostIds = mergedItems.map((item) => item.postId);
    const interactions = await this.prismaService.exploreInteraction.findMany({
      where: {
        userId,
        postId: {
          in: candidatePostIds,
        },
      },
      select: {
        postId: true,
        eventType: true,
      },
    });

    const topicAffinity = this.buildTopicAffinityMap(profiles);
    const followingSet = new Set(followingIds);
    const perPostEventCounter = this.buildPostEventCounter(interactions);

    const ranked = mergedItems
      .map((item) => {
        const postEvents = perPostEventCounter.get(item.postId) ?? {};
        const seenCount =
          (postEvents.IMPRESSION ?? 0) +
          (postEvents.OPEN_POST ?? 0) +
          (postEvents.WATCH_3S ?? 0) +
          (postEvents.WATCH_50 ?? 0);

        const ageHours = (Date.now() - item.createdAt.getTime()) / 3_600_000;
        const topicBonus = Math.min(10, (topicAffinity[item.topic] ?? 0) * 0.8);
        const followBonus = followingSet.has(item.post.user.id) ? 3.5 : 0;
        const freshnessBonus = Math.max(0, 24 - ageHours) * 0.08;
        const positiveFeedbackBonus =
          (postEvents.LIKE ?? 0) * 1.2 + (postEvents.COMMENT ?? 0) * 1.8;
        const seenPenalty = Math.min(4, seenCount * 0.6);
        const skipPenalty = Math.max(
          0,
          ((postEvents.IMPRESSION ?? 0) - (postEvents.OPEN_POST ?? 0)) * 0.35,
        );

        const personalScore =
          item.score +
          topicBonus +
          followBonus +
          freshnessBonus +
          positiveFeedbackBonus -
          seenPenalty -
          skipPenalty;

        return {
          ...item,
          personalScore: Number(personalScore.toFixed(4)),
        };
      })
      .sort((a, b) => {
        if (b.personalScore !== a.personalScore) {
          return b.personalScore - a.personalScore;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    const startIndex = cursor
      ? Math.max(0, ranked.findIndex((item) => item.id === cursor) + 1)
      : 0;
    const page = ranked.slice(startIndex, startIndex + limit);
    const hasNext = startIndex + limit < ranked.length;

    return {
      mode: 'for_you',
      data: page,
      nextCursor: hasNext ? (page[page.length - 1]?.id ?? null) : null,
      limit,
      signals: {
        topTopics: profiles.slice(0, 3).map((profile) => ({
          topic: profile.topic,
          score: Number(
            this.decayTopicScore(profile.score, profile.updatedAt).toFixed(3),
          ),
        })),
        followingCreators: followingIds.length,
      },
    };
  }

  async recordEvent(userId: string, dto: RecordExploreEventDto) {
    const batchResult = await this.processExploreEvents(userId, [dto], {
      dedupeImpression: false,
    });

    const recorded = batchResult.recorded[0];
    return {
      ok: true,
      postId: recorded?.postId ?? dto.postId,
      topic: recorded?.topic ?? null,
      eventType: recorded?.eventType ?? dto.eventType,
      weight: recorded?.weight ?? 0,
    };
  }

  async recordEventsBatch(userId: string, dto: BatchRecordExploreEventsDto) {
    const batchResult = await this.processExploreEvents(userId, dto.events, {
      dedupeImpression: true,
    });

    return {
      ok: true,
      requested: dto.events.length,
      accepted: batchResult.acceptedCount,
      recordedCount: batchResult.recorded.length,
      skippedCount: batchResult.skippedCount,
      groupedByType: batchResult.groupedByType,
      topicUpdates: batchResult.topicUpdates,
      hiddenPostCount: batchResult.hiddenPostCount,
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

    this.logger.debug(
      `Explore scores refreshed for ${publicPosts.length} posts`,
    );
  }

  private resolvePublicMode(
    mode: ExploreQueryDto['mode'],
    sort?: ExploreQueryDto['sort'],
  ): ExploreMode {
    if (sort === 'newest') return 'new';
    if (sort === 'score') return mode === 'new' ? 'new' : 'top';
    if (mode === 'new' || mode === 'top') return mode;
    return 'trending';
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

  private buildExploreWhere(options: {
    normalizedTopic?: string;
    topicsIn?: string[];
    followingIds?: string[];
    hiddenPostIds?: string[];
    trendingOnly?: boolean;
  }): Prisma.ExploreItemWhereInput {
    const where: Prisma.ExploreItemWhereInput = {
      ...(options.normalizedTopic && { topic: options.normalizedTopic }),
      ...(options.topicsIn?.length && { topic: { in: options.topicsIn } }),
      ...(options.trendingOnly && { isTrending: true }),
      ...(options.hiddenPostIds?.length && {
        postId: { notIn: options.hiddenPostIds },
      }),
      post: {
        isPublic: true,
        ...(options.followingIds?.length && {
          userId: { in: options.followingIds },
        }),
      },
    };

    return where;
  }

  private mergeById(items: ExploreItemWithRelations[]) {
    const map = new Map<string, ExploreItemWithRelations>();
    for (const item of items) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }

  private buildTopicAffinityMap(
    profiles: Array<{ topic: string; score: number; updatedAt: Date }>,
  ) {
    const map: Record<string, number> = {};
    for (const profile of profiles) {
      map[profile.topic] = this.decayTopicScore(
        profile.score,
        profile.updatedAt,
      );
    }
    return map;
  }

  private decayTopicScore(score: number, updatedAt: Date) {
    const ageHours = (Date.now() - updatedAt.getTime()) / 3_600_000;
    const decayed = score * Math.exp(-0.012 * ageHours);
    return Math.max(-20, Math.min(20, decayed));
  }

  private buildPostEventCounter(
    interactions: Array<{ postId: string; eventType: ExploreEventType }>,
  ) {
    const map = new Map<string, Partial<Record<ExploreEventType, number>>>();

    for (const interaction of interactions) {
      const row = map.get(interaction.postId) ?? {};
      row[interaction.eventType] = (row[interaction.eventType] ?? 0) + 1;
      map.set(interaction.postId, row);
    }

    return map;
  }

  private async processExploreEvents(
    userId: string,
    inputEvents: ExploreEventInput[],
    options: { dedupeImpression: boolean },
  ) {
    const normalizedEvents = this.normalizeExploreEvents(
      inputEvents,
      options.dedupeImpression,
    );

    if (normalizedEvents.length === 0) {
      return {
        acceptedCount: 0,
        skippedCount: 0,
        hiddenPostCount: 0,
        groupedByType: {},
        topicUpdates: [],
        recorded: [] as Array<{
          postId: string;
          topic: string;
          eventType: ExploreEventType;
          weight: number;
        }>,
      };
    }

    const uniquePostIds = Array.from(
      new Set(normalizedEvents.map((event) => event.postId)),
    );
    const postTopicMap = await this.resolvePostTopicMap(uniquePostIds);

    const now = new Date();
    const interactionsData: Prisma.ExploreInteractionCreateManyInput[] = [];
    const topicWeightMap = new Map<string, number>();
    const hiddenPostIds = new Set<string>();
    const groupedByType: Partial<Record<ExploreEventType, number>> = {};

    for (const event of normalizedEvents) {
      const topic = postTopicMap.get(event.postId);
      if (!topic) {
        continue;
      }

      const eventType = event.eventType as ExploreEventType;
      const weight = EVENT_WEIGHTS[eventType];
      if (typeof weight !== 'number') {
        continue;
      }

      interactionsData.push({
        userId,
        postId: event.postId,
        topic,
        eventType,
        weight,
        ...(event.metadata !== undefined && {
          metadata: event.metadata as Prisma.InputJsonValue,
        }),
      });

      topicWeightMap.set(topic, (topicWeightMap.get(topic) ?? 0) + weight);
      groupedByType[eventType] = (groupedByType[eventType] ?? 0) + 1;

      if (eventType === ExploreEventType.HIDE) {
        hiddenPostIds.add(event.postId);
      }
    }

    if (interactionsData.length === 0) {
      return {
        acceptedCount: normalizedEvents.length,
        skippedCount: normalizedEvents.length,
        hiddenPostCount: 0,
        groupedByType: {},
        topicUpdates: [],
        recorded: [] as Array<{
          postId: string;
          topic: string;
          eventType: ExploreEventType;
          weight: number;
        }>,
      };
    }

    await this.prismaService.$transaction(async (tx) => {
      await tx.exploreInteraction.createMany({
        data: interactionsData,
      });

      for (const [topic, totalWeight] of topicWeightMap.entries()) {
        await tx.userTopicProfile.upsert({
          where: {
            userId_topic: {
              userId,
              topic,
            },
          },
          update: {
            score: {
              increment: totalWeight,
            },
            lastEventAt: now,
          },
          create: {
            userId,
            topic,
            score: totalWeight,
            lastEventAt: now,
          },
        });
      }

      for (const postId of hiddenPostIds) {
        await tx.hiddenPost.upsert({
          where: {
            userId_postId: {
              userId,
              postId,
            },
          },
          update: {
            reason: 'user_hidden_from_explore',
          },
          create: {
            userId,
            postId,
            reason: 'user_hidden_from_explore',
          },
        });
      }
    });

    const recorded = interactionsData.map((item) => ({
      postId: item.postId,
      topic: item.topic ?? 'general',
      eventType: item.eventType,
      weight: item.weight,
    }));

    return {
      acceptedCount: normalizedEvents.length,
      skippedCount: normalizedEvents.length - interactionsData.length,
      hiddenPostCount: hiddenPostIds.size,
      groupedByType,
      topicUpdates: Array.from(topicWeightMap.entries()).map(
        ([topic, totalWeight]) => ({
          topic,
          totalWeight: Number(totalWeight.toFixed(4)),
        }),
      ),
      recorded,
    };
  }

  private normalizeExploreEvents(
    events: ExploreEventInput[],
    dedupeImpression: boolean,
  ) {
    const normalized: ExploreEventInput[] = [];
    const impressionSeen = new Set<string>();
    const eventSeen = new Set<string>();

    for (const event of events) {
      const postId = event.postId?.trim();
      if (!postId) continue;

      const eventType = event.eventType?.toUpperCase();
      if (!eventType || !(eventType in EVENT_WEIGHTS)) continue;

      const normalizedEvent: ExploreEventInput = {
        postId,
        eventType: eventType as ExploreEventInput['eventType'],
        metadata: event.metadata,
      };

      if (dedupeImpression && normalizedEvent.eventType === 'IMPRESSION') {
        if (impressionSeen.has(postId)) continue;
        impressionSeen.add(postId);
      } else if (dedupeImpression) {
        const key = `${postId}:${normalizedEvent.eventType}`;
        if (eventSeen.has(key)) continue;
        eventSeen.add(key);
      }

      normalized.push(normalizedEvent);
    }

    return normalized;
  }

  private async resolvePostTopicMap(postIds: string[]) {
    const topicMap = new Map<string, string>();
    if (postIds.length === 0) return topicMap;

    let existingItems = await this.prismaService.exploreItem.findMany({
      where: {
        postId: { in: postIds },
      },
      select: {
        postId: true,
        topic: true,
      },
    });

    const missingPostIds = postIds.filter(
      (postId) => !existingItems.some((item) => item.postId === postId),
    );

    if (missingPostIds.length > 0) {
      await Promise.all(missingPostIds.map((postId) => this.syncPost(postId)));
      existingItems = await this.prismaService.exploreItem.findMany({
        where: {
          postId: { in: postIds },
        },
        select: {
          postId: true,
          topic: true,
        },
      });
    }

    for (const item of existingItems) {
      topicMap.set(item.postId, item.topic);
    }

    return topicMap;
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
