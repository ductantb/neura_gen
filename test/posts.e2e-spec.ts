import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PostsController } from '../src/modules/posts/posts.controller';
import { PostsService } from '../src/modules/posts/posts.service';

describe('PostsController (e2e)', () => {
  let app: INestApplication<App>;

  const postsService = {
    findOne: jest.fn(),
    trackView: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [
        {
          provide: PostsService,
          useValue: postsService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /posts/:id returns thumbnailUrl and videoUrl in the HTTP response', async () => {
    const postResponse = {
      id: 'post-1',
      caption: 'demo video',
      thumbnailUrl: 'https://signed.example/thumb.jpg',
      videoUrl: 'https://signed.example/video.mp4',
      assetVersion: {
        id: 'version-1',
      },
    };

    postsService.findOne.mockResolvedValue(postResponse);
    postsService.trackView.mockResolvedValue(true);

    await request(app.getHttpServer())
      .get('/posts/post-1')
      .set('x-forwarded-for', '203.0.113.10, 10.0.0.1')
      .set('user-agent', 'jest-agent')
      .expect(200)
      .expect(postResponse);

    expect(postsService.trackView).toHaveBeenCalledWith(
      'post-1',
      '203.0.113.10',
      'jest-agent',
      undefined,
    );
    expect(postsService.findOne).toHaveBeenCalledWith('post-1');
  });
});
