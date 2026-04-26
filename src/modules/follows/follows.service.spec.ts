import { FollowsService } from './follows.service';

describe('FollowsService', () => {
  const prisma = {
    follow: {
      create: jest.fn(),
    },
    post: {
      findUnique: jest.fn(),
    },
  };

  const exploreService = {
    recordEvent: jest.fn(),
  };

  let service: FollowsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FollowsService(prisma as any, exploreService as any);
  });

  it('records a FOLLOW_CREATOR explore signal when follow originates from a public post card', async () => {
    prisma.follow.create.mockResolvedValue({
      id: 'follow-1',
      followerId: 'user-1',
      followingId: 'creator-1',
    });
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      userId: 'creator-1',
      isPublic: true,
    });
    exploreService.recordEvent.mockResolvedValue({ ok: true });

    await service.create('user-1', {
      followingId: 'creator-1',
      sourcePostId: 'post-1',
    });

    expect(exploreService.recordEvent).toHaveBeenCalledWith('user-1', {
      postId: 'post-1',
      eventType: 'FOLLOW_CREATOR',
      metadata: {
        source: 'follow_action',
      },
    });
  });

  it('skips the explore signal when sourcePostId does not belong to the followed creator', async () => {
    prisma.follow.create.mockResolvedValue({
      id: 'follow-1',
      followerId: 'user-1',
      followingId: 'creator-1',
    });
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      userId: 'creator-2',
      isPublic: true,
    });

    await service.create('user-1', {
      followingId: 'creator-1',
      sourcePostId: 'post-1',
    });

    expect(exploreService.recordEvent).not.toHaveBeenCalled();
  });
});
