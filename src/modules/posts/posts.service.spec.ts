import { PostsService } from './posts.service';

describe('PostsService', () => {
  const prismaService = {
    post: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const storageService = {
    getDownloadSignedUrl: jest.fn(),
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
      storageService as any,
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
        fileUrl: null,
        objectKey: 'jobs/job-1/output/video.mp4',
        mimeType: 'video/mp4',
        metadata: {},
        asset: {
          type: 'VIDEO',
          job: {
            assets: [
              {
                versions: [
                  {
                    fileUrl: null,
                    objectKey: 'jobs/job-1/output/thumb.jpg',
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
    storageService.getDownloadSignedUrl
      .mockResolvedValueOnce({
        url: 'https://signed.example/thumb.jpg',
        expiresIn: 3600,
      })
      .mockResolvedValueOnce({
        url: 'https://signed.example/video.mp4',
        expiresIn: 3600,
      });

    const post = await service.findOne('post-1');

    expect(post).toMatchObject({
      id: 'post-1',
      videoUrl: 'https://signed.example/video.mp4',
      thumbnailUrl: 'https://signed.example/thumb.jpg',
    });
  });

  it('falls back to the assetVersion objectKey as thumbnailUrl for image posts', async () => {
    prismaService.post.findUnique.mockResolvedValue({
      id: 'post-2',
      assetVersionId: 'version-2',
      assetVersion: {
        id: 'version-2',
        fileUrl: null,
        objectKey: 'users/user-1/uploads/image.png',
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
    storageService.getDownloadSignedUrl.mockResolvedValueOnce({
      url: 'https://signed.example/image.png',
      expiresIn: 3600,
    });

    const post = await service.findOne('post-2');

    expect(post).toMatchObject({
      id: 'post-2',
      videoUrl: null,
      thumbnailUrl: 'https://signed.example/image.png',
    });
  });

  it('accepts videoUrl and thumbnailUrl in create request but does not persist them', async () => {
    prismaService.post.create.mockResolvedValue({
      id: 'post-3',
    });
    prismaService.post.findUnique.mockResolvedValue({
      id: 'post-3',
      assetVersionId: 'version-3',
      assetVersion: {
        id: 'version-3',
        fileUrl: null,
        objectKey: 'jobs/job-3/output/video.mp4',
        mimeType: 'video/mp4',
        metadata: {},
        asset: {
          type: 'VIDEO',
          job: {
            assets: [],
          },
        },
      },
      user: {
        id: 'user-1',
        username: 'alice',
      },
    });
    storageService.getDownloadSignedUrl.mockResolvedValue({
      url: 'https://signed.example/video.mp4',
      expiresIn: 3600,
    });

    await service.create('user-1', {
      assetVersionId: 'version-3',
      caption: 'demo',
      isPublic: true,
      videoUrl: 'https://client.example/video.mp4',
      thumbnailUrl: 'https://client.example/thumb.jpg',
    });

    expect(prismaService.post.create).toHaveBeenCalledWith({
      data: {
        assetVersionId: 'version-3',
        caption: 'demo',
        isPublic: true,
        userId: 'user-1',
      },
    });
  });
});
