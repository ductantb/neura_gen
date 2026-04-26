import { BadRequestException } from '@nestjs/common';
import { CommentsController } from './comments.controller';

describe('CommentsController', () => {
  const commentsService = {
    create: jest.fn(),
  };

  let controller: CommentsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CommentsController(commentsService as any);
  });

  it('uses postId from the nested route when creating a comment', () => {
    const user = { sub: 'user-1', role: 'FREE' } as any;
    const dto = { content: 'hello world' };

    controller.create('post-1', user, dto);

    expect(commentsService.create).toHaveBeenCalledWith('user-1', {
      content: 'hello world',
      postId: 'post-1',
    });
  });

  it('rejects mismatched postId between route and body', () => {
    const user = { sub: 'user-1', role: 'FREE' } as any;

    expect(() =>
      controller.create('post-1', user, {
        postId: 'post-2',
        content: 'hello world',
      }),
    ).toThrow(BadRequestException);
  });
});
