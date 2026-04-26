import { BadRequestException } from '@nestjs/common';
import { PostLikesController } from './post-likes.controller';

describe('PostLikesController', () => {
  const postLikesService = {
    create: jest.fn(),
  };

  let controller: PostLikesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PostLikesController(postLikesService as any);
  });

  it('uses postId from the nested route when creating a like', () => {
    const user = { sub: 'user-1', role: 'FREE' } as any;

    controller.create('post-1', user, {});

    expect(postLikesService.create).toHaveBeenCalledWith('user-1', {
      postId: 'post-1',
    });
  });

  it('rejects mismatched postId between route and body', () => {
    const user = { sub: 'user-1', role: 'FREE' } as any;

    expect(() =>
      controller.create('post-1', user, {
        postId: 'post-2',
      }),
    ).toThrow(BadRequestException);
  });
});
