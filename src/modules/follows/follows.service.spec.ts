import { FollowsService } from './follows.service';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

describe('FollowsService', () => {
  const prisma = {
    follow: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
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

  it('allows ADMIN to remove another user follow relation when followerId is provided', async () => {
    prisma.follow.findUnique.mockResolvedValue({
      id: 'follow-1',
      followerId: 'user-2',
      followingId: 'creator-1',
    });
    prisma.follow.delete.mockResolvedValue({ id: 'follow-1' });

    await service.remove(
      { followerId: 'admin-1', role: UserRole.ADMIN },
      'creator-1',
      'user-2',
    );

    expect(prisma.follow.findUnique).toHaveBeenCalledWith({
      where: {
        followerId_followingId: {
          followerId: 'user-2',
          followingId: 'creator-1',
        },
      },
    });
    expect(prisma.follow.delete).toHaveBeenCalledWith({
      where: {
        followerId_followingId: {
          followerId: 'user-2',
          followingId: 'creator-1',
        },
      },
    });
  });

  it('rejects non-admin attempts to remove another user follow relation', async () => {
    await expect(
      service.remove(
        { followerId: 'user-1', role: UserRole.FREE },
        'creator-1',
        'user-2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.follow.findUnique).not.toHaveBeenCalled();
  });
});
