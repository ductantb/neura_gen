import { ExploreService } from './explore.service';

describe('ExploreService', () => {
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

  let service: ExploreService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExploreService(prismaService as any);
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
});
