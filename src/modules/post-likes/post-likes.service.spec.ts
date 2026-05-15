import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PostLikesService } from './post-likes.service';

describe('PostLikesService', () => {
  const prismaTx = {
    postLike: {
      delete: jest.fn(),
    },
    post: {
      update: jest.fn(),
    },
  };

  const prisma = {
    postLike: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback: (tx: typeof prismaTx) => unknown) =>
      Promise.resolve(callback(prismaTx)),
    ),
  };

  const exploreService = {
    syncPost: jest.fn(),
  };

  let service: PostLikesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PostLikesService(prisma as any, exploreService as any);
  });

  it('allows ADMIN to remove another user post like when target userId is provided', async () => {
    prisma.postLike.findUnique.mockResolvedValue({
      id: 'like-1',
      userId: 'user-2',
      postId: 'post-1',
    });
    prismaTx.postLike.delete.mockResolvedValue({ id: 'like-1' });
    prismaTx.post.update.mockResolvedValue({ id: 'post-1' });

    await service.removeWithTarget(
      'post-1',
      { sub: 'admin-1', role: UserRole.ADMIN },
      'user-2',
    );

    expect(prisma.postLike.findUnique).toHaveBeenCalledWith({
      where: {
        userId_postId: {
          userId: 'user-2',
          postId: 'post-1',
        },
      },
    });
    expect(prismaTx.postLike.delete).toHaveBeenCalledWith({
      where: {
        userId_postId: {
          userId: 'user-2',
          postId: 'post-1',
        },
      },
    });
    expect(exploreService.syncPost).toHaveBeenCalledWith('post-1');
  });

  it('rejects non-admin attempts to remove another user post like', async () => {
    await expect(
      service.removeWithTarget(
        'post-1',
        { sub: 'user-1', role: UserRole.FREE },
        'user-2',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.postLike.findUnique).not.toHaveBeenCalled();
  });
});
