import { ExploreService } from './explore.service';

describe('ExploreService', () => {
  const originalExploreDebugFlag = process.env.EXPLORE_FOR_YOU_DEBUG_ENABLED;
  const prismaService = {
    exploreItem: {
      findMany: jest.fn(),
    },
    userTopicProfile: {
      findMany: jest.fn(),
    },
    follow: {
      findMany: jest.fn(),
    },
    hiddenPost: {
      findMany: jest.fn(),
    },
    exploreInteraction: {
      findMany: jest.fn(),
    },
  };
  const storageService = {
    getDownloadSignedUrl: jest.fn(),
  };

  let service: ExploreService;

  const makeItem = (overrides?: Record<string, any>) => {
    const postId = overrides?.post?.id ?? overrides?.postId ?? 'post-1';

    return {
      id: 'item-1',
      topic: 'anime',
      score: 10,
      createdAt: new Date('2026-05-04T08:00:00.000Z'),
      assetVersion: {
        asset: {},
      },
      ...overrides,
      postId,
      post: {
        id: postId,
        createdAt:
          overrides?.post?.createdAt ?? new Date('2026-05-04T08:00:00.000Z'),
        user: {
          id: overrides?.post?.user?.id ?? 'creator-1',
          username: overrides?.post?.user?.username ?? 'creator-1',
          avatarUrl: overrides?.post?.user?.avatarUrl ?? null,
        },
      },
    };
  };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.EXPLORE_FOR_YOU_DEBUG_ENABLED = 'false';
    storageService.getDownloadSignedUrl.mockResolvedValue({
      url: 'https://signed.example/mock.jpg',
    });
    service = new ExploreService(prismaService as any, storageService as any);
  });

  afterAll(() => {
    if (originalExploreDebugFlag === undefined) {
      delete process.env.EXPLORE_FOR_YOU_DEBUG_ENABLED;
      return;
    }

    process.env.EXPLORE_FOR_YOU_DEBUG_ENABLED = originalExploreDebugFlag;
  });

  it('orders the public "new" feed by Post.createdAt instead of ExploreItem.createdAt', async () => {
    prismaService.exploreItem.findMany.mockResolvedValue([]);

    await service.getExplore({
      mode: 'new',
      limit: 20,
    });

    expect(prismaService.exploreItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ post: { createdAt: 'desc' } }, { score: 'desc' }],
      }),
    );
  });

  it('searches explore items by topic via the public top-mode feed', async () => {
    prismaService.exploreItem.findMany.mockResolvedValue([]);

    await service.searchByTopic({
      topic: 'anime',
      sort: 'score',
      limit: 20,
    });

    expect(prismaService.exploreItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          topic: 'anime',
        }),
        orderBy: [{ score: 'desc' }, { post: { createdAt: 'desc' } }],
      }),
    );
  });

  it('falls back to trending when the user has no topic profile and follows nobody', async () => {
    prismaService.userTopicProfile.findMany.mockResolvedValue([]);
    prismaService.follow.findMany.mockResolvedValue([]);
    prismaService.hiddenPost.findMany.mockResolvedValue([]);
    prismaService.exploreItem.findMany.mockResolvedValue([]);

    const result = await service.getForYou('user-1', { limit: 20 });

    expect(result.mode).toBe('for_you');
    expect((result as any).fallback).toBe('trending');
    expect(prismaService.exploreItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isTrending: true,
          post: {
            isPublic: true,
          },
        }),
        orderBy: [{ score: 'desc' }, { post: { createdAt: 'desc' } }],
      }),
    );
  });

  it('uses Post.createdAt when ranking the for-you feed freshness', async () => {
    prismaService.userTopicProfile.findMany.mockResolvedValue([
      {
        topic: 'anime',
        score: 10,
        updatedAt: new Date('2026-04-26T00:00:00.000Z'),
      },
    ]);
    prismaService.follow.findMany.mockResolvedValue([]);
    prismaService.hiddenPost.findMany.mockResolvedValue([]);
    prismaService.exploreItem.findMany
      .mockResolvedValueOnce([
        {
          id: 'item-a',
          postId: 'post-a',
          topic: 'anime',
          score: 5,
          createdAt: new Date('2026-04-26T11:00:00.000Z'),
          post: {
            id: 'post-a',
            createdAt: new Date('2026-04-20T00:00:00.000Z'),
            user: {
              id: 'creator-1',
              username: 'creator-1',
              avatarUrl: null,
            },
          },
          assetVersion: {
            asset: {},
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'item-a',
          postId: 'post-a',
          topic: 'anime',
          score: 5,
          createdAt: new Date('2026-04-26T11:00:00.000Z'),
          post: {
            id: 'post-a',
            createdAt: new Date('2026-04-20T00:00:00.000Z'),
            user: {
              id: 'creator-1',
              username: 'creator-1',
              avatarUrl: null,
            },
          },
          assetVersion: {
            asset: {},
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'item-b',
          postId: 'post-b',
          topic: 'anime',
          score: 5,
          createdAt: new Date('2026-04-20T00:00:00.000Z'),
          post: {
            id: 'post-b',
            createdAt: new Date('2026-04-26T11:00:00.000Z'),
            user: {
              id: 'creator-2',
              username: 'creator-2',
              avatarUrl: null,
            },
          },
          assetVersion: {
            asset: {},
          },
        },
      ]);
    prismaService.exploreInteraction.findMany.mockResolvedValue([]);

    const result = await service.getForYou('user-1', { limit: 20 });

    expect(result.data[0]?.postId).toBe('post-b');
  });

  it('passes hidden post ids into for-you candidate queries', async () => {
    prismaService.userTopicProfile.findMany.mockResolvedValue([
      {
        topic: 'anime',
        score: 5,
        updatedAt: new Date('2026-05-03T10:00:00.000Z'),
      },
    ]);
    prismaService.follow.findMany.mockResolvedValue([
      { followingId: 'creator-1' },
    ]);
    prismaService.hiddenPost.findMany.mockResolvedValue([
      { postId: 'post-hidden' },
    ]);
    prismaService.exploreItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.getForYou('user-1', { limit: 20 });

    expect(prismaService.exploreItem.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          topic: { in: ['anime'] },
          postId: { notIn: ['post-hidden'] },
        }),
      }),
    );
    expect(prismaService.exploreItem.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          postId: { notIn: ['post-hidden'] },
          post: {
            isPublic: true,
            userId: { in: ['creator-1'] },
          },
        }),
      }),
    );
    expect(prismaService.exploreItem.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          isTrending: true,
          postId: { notIn: ['post-hidden'] },
        }),
      }),
    );
    expect(prismaService.exploreItem.findMany).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: expect.objectContaining({
          postId: { notIn: ['post-hidden'] },
        }),
      }),
    );
  });

  it('boosts posts from followed creators in for-you ranking', async () => {
    prismaService.userTopicProfile.findMany.mockResolvedValue([
      {
        topic: 'anime',
        score: 0,
        updatedAt: new Date('2026-05-03T10:00:00.000Z'),
      },
    ]);
    prismaService.follow.findMany.mockResolvedValue([
      { followingId: 'creator-followed' },
    ]);
    prismaService.hiddenPost.findMany.mockResolvedValue([]);

    const followedItem = makeItem({
      id: 'item-followed',
      postId: 'post-followed',
      score: 6,
      post: {
        id: 'post-followed',
        createdAt: new Date('2026-05-03T20:00:00.000Z'),
        user: {
          id: 'creator-followed',
          username: 'creator-followed',
          avatarUrl: null,
        },
      },
    });
    const nonFollowedItem = makeItem({
      id: 'item-other',
      postId: 'post-other',
      score: 6,
      post: {
        id: 'post-other',
        createdAt: new Date('2026-05-04T06:00:00.000Z'),
        user: {
          id: 'creator-other',
          username: 'creator-other',
          avatarUrl: null,
        },
      },
    });

    prismaService.exploreItem.findMany
      .mockResolvedValueOnce([followedItem])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([nonFollowedItem]);
    prismaService.exploreInteraction.findMany.mockResolvedValue([]);

    const result = await service.getForYou('user-1', { limit: 20 });

    expect(result.data[0]?.postId).toBe('post-followed');
  });

  it('boosts creators the user has interacted with recently in for-you ranking', async () => {
    prismaService.userTopicProfile.findMany.mockResolvedValue([
      {
        topic: 'anime',
        score: 8,
        updatedAt: new Date('2026-05-03T10:00:00.000Z'),
      },
    ]);
    prismaService.follow.findMany.mockResolvedValue([]);
    prismaService.hiddenPost.findMany.mockResolvedValue([]);

    const creatorOneItem = {
      id: 'item-1',
      postId: 'post-1',
      topic: 'anime',
      score: 9,
      createdAt: new Date('2026-05-04T08:00:00.000Z'),
      post: {
        id: 'post-1',
        createdAt: new Date('2026-05-04T08:00:00.000Z'),
        user: {
          id: 'creator-1',
          username: 'creator-1',
          avatarUrl: null,
        },
      },
      assetVersion: {
        asset: {},
      },
    };
    const creatorTwoItem = {
      id: 'item-2',
      postId: 'post-2',
      topic: 'anime',
      score: 9,
      createdAt: new Date('2026-05-04T08:00:00.000Z'),
      post: {
        id: 'post-2',
        createdAt: new Date('2026-05-04T08:00:00.000Z'),
        user: {
          id: 'creator-2',
          username: 'creator-2',
          avatarUrl: null,
        },
      },
      assetVersion: {
        asset: {},
      },
    };

    prismaService.exploreItem.findMany
      .mockResolvedValueOnce([creatorOneItem, creatorTwoItem])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([creatorOneItem, creatorTwoItem]);

    prismaService.exploreInteraction.findMany.mockResolvedValue([
      {
        postId: 'older-post-by-creator-2',
        eventType: 'LIKE',
        createdAt: new Date('2026-05-04T11:00:00.000Z'),
        post: {
          userId: 'creator-2',
        },
      },
    ]);

    const result = await service.getForYou('user-1', { limit: 20 });

    expect(result.data[0]?.postId).toBe('post-2');
  });

  it('diversifies repeated creators so the same creator does not dominate the page', async () => {
    prismaService.userTopicProfile.findMany.mockResolvedValue([
      {
        topic: 'anime',
        score: 0,
        updatedAt: new Date('2026-05-03T10:00:00.000Z'),
      },
    ]);
    prismaService.follow.findMany.mockResolvedValue([]);
    prismaService.hiddenPost.findMany.mockResolvedValue([]);

    const creatorOneTop = makeItem({
      id: 'item-1',
      postId: 'post-1',
      score: 10,
      post: {
        id: 'post-1',
        createdAt: new Date('2026-05-04T08:00:00.000Z'),
        user: {
          id: 'creator-1',
          username: 'creator-1',
          avatarUrl: null,
        },
      },
    });
    const creatorOneSecond = makeItem({
      id: 'item-2',
      postId: 'post-2',
      score: 9.8,
      post: {
        id: 'post-2',
        createdAt: new Date('2026-05-04T07:30:00.000Z'),
        user: {
          id: 'creator-1',
          username: 'creator-1',
          avatarUrl: null,
        },
      },
    });
    const creatorTwoItem = makeItem({
      id: 'item-3',
      postId: 'post-3',
      score: 9.2,
      post: {
        id: 'post-3',
        createdAt: new Date('2026-05-04T07:00:00.000Z'),
        user: {
          id: 'creator-2',
          username: 'creator-2',
          avatarUrl: null,
        },
      },
    });

    prismaService.exploreItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([creatorOneTop, creatorOneSecond, creatorTwoItem]);
    prismaService.exploreInteraction.findMany.mockResolvedValue([]);

    const result = await service.getForYou('user-1', { limit: 20 });

    expect(result.data.map((item) => item.post.user.id)).toEqual([
      'creator-1',
      'creator-2',
      'creator-1',
    ]);
  });

  it('returns score breakdown when for-you debug mode is enabled', async () => {
    process.env.EXPLORE_FOR_YOU_DEBUG_ENABLED = 'true';

    prismaService.userTopicProfile.findMany.mockResolvedValue([
      {
        topic: 'anime',
        score: 8,
        updatedAt: new Date('2026-05-03T10:00:00.000Z'),
      },
    ]);
    prismaService.follow.findMany.mockResolvedValue([
      { followingId: 'creator-1' },
    ]);
    prismaService.hiddenPost.findMany.mockResolvedValue([]);

    const item = {
      id: 'item-1',
      postId: 'post-1',
      topic: 'anime',
      score: 12,
      createdAt: new Date('2026-05-04T08:00:00.000Z'),
      post: {
        id: 'post-1',
        createdAt: new Date('2026-05-04T08:00:00.000Z'),
        user: {
          id: 'creator-1',
          username: 'creator-1',
          avatarUrl: null,
        },
      },
      assetVersion: {
        asset: {},
      },
    };

    prismaService.exploreItem.findMany
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item]);

    prismaService.exploreInteraction.findMany.mockResolvedValue([
      {
        postId: 'post-1',
        eventType: 'LIKE',
        createdAt: new Date('2026-05-04T11:00:00.000Z'),
        post: {
          userId: 'creator-1',
        },
      },
    ]);

    const result = await service.getForYou('user-1', {
      limit: 20,
      debug: 'true',
    });

    expect((result as any).debug).toEqual(
      expect.objectContaining({
        candidateCount: expect.any(Number),
        interactionSampleCount: 1,
        preferredTopics: ['anime'],
        followingIds: ['creator-1'],
      }),
    );
    expect((result.data[0] as any)?.debug).toEqual(
      expect.objectContaining({
        candidateSources: expect.arrayContaining(['topic', 'following', 'fresh']),
        baseScore: 12,
        followBonus: 3.5,
        finalScore: expect.any(Number),
      }),
    );
  });

  it('does not expose score breakdown when server-side debug flag is disabled', async () => {
    prismaService.userTopicProfile.findMany.mockResolvedValue([
      {
        topic: 'anime',
        score: 8,
        updatedAt: new Date('2026-05-03T10:00:00.000Z'),
      },
    ]);
    prismaService.follow.findMany.mockResolvedValue([]);
    prismaService.hiddenPost.findMany.mockResolvedValue([]);

    const item = {
      id: 'item-1',
      postId: 'post-1',
      topic: 'anime',
      score: 12,
      createdAt: new Date('2026-05-04T08:00:00.000Z'),
      post: {
        id: 'post-1',
        createdAt: new Date('2026-05-04T08:00:00.000Z'),
        user: {
          id: 'creator-1',
          username: 'creator-1',
          avatarUrl: null,
        },
      },
      assetVersion: {
        asset: {},
      },
    };

    prismaService.exploreItem.findMany
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item]);

    prismaService.exploreInteraction.findMany.mockResolvedValue([]);

    const result = await service.getForYou('user-1', {
      limit: 20,
      debug: 'true',
    });

    expect((result as any).debug).toBeUndefined();
    expect((result.data[0] as any)?.debug).toBeUndefined();
  });
});
