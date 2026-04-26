import { PostsController } from './posts.controller';

describe('PostsController', () => {
  const postsService = {
    findOne: jest.fn(),
    trackView: jest.fn(),
  };

  let controller: PostsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PostsController(postsService as any);
  });

  it('returns a public post detail without requiring a current user', async () => {
    const post = { id: 'post-1' };
    postsService.findOne.mockResolvedValue(post);
    postsService.trackView.mockResolvedValue(true);

    const req = {
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        'user-agent': 'jest-agent',
      },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    await expect(controller.findOne('post-1', req)).resolves.toEqual(post);
    expect(postsService.trackView).toHaveBeenCalledWith(
      'post-1',
      '203.0.113.10',
      'jest-agent',
      undefined,
    );
  });
});
