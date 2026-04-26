import { PostsService } from './posts.service';

describe('PostsService', () => {
  const prismaService = {
    post: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const redis = {
    set: jest.fn(),
    hincrby: jest.fn(),
    rename: jest.fn(),
    hgetall: jest.fn(),
    del: jest.fn(),
  };

  const exploreService = {
    syncPost: jest.fn(),
  };

  let service: PostsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PostsService(
      prismaService as any,
      redis as any,
      exploreService as any,
    );
  });

  it('returns videoUrl from the post asset version and thumbnailUrl from the thumbnail asset', async () => {
    prismaService.post.findUnique.mockResolvedValue({
      id: 'post-1',
      assetVersionId: 'version-1',
      assetVersion: {
        id: 'version-1',
        fileUrl: 'https://cdn.example/video.mp4',
        mimeType: 'video/mp4',
        metadata: {},
        asset: {
          type: 'VIDEO',
          job: {
            assets: [
              {
                versions: [
                  {
                    fileUrl: 'https://cdn.example/thumb.jpg',
                  },
                ],
              },
            ],
          },
        },
      },
      user: {
        id: 'user-1',
        username: 'alice',
      },
    });

    const post = await service.findOne('post-1');

    expect(post).toMatchObject({
      id: 'post-1',
      videoUrl: 'https://cdn.example/video.mp4',
      thumbnailUrl: 'https://cdn.example/thumb.jpg',
    });
  });

  it('falls back to the assetVersion fileUrl as thumbnailUrl for image posts', async () => {
    prismaService.post.findUnique.mockResolvedValue({
      id: 'post-2',
      assetVersionId: 'version-2',
      assetVersion: {
        id: 'version-2',
        fileUrl: 'https://cdn.example/image.png',
        mimeType: 'image/png',
        metadata: {},
        asset: {
          type: 'IMAGE',
          job: null,
        },
      },
      user: {
        id: 'user-1',
        username: 'alice',
      },
    });

    const post = await service.findOne('post-2');

    expect(post).toMatchObject({
      id: 'post-2',
      videoUrl: null,
      thumbnailUrl: 'https://cdn.example/image.png',
    });
  });
});
