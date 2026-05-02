import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { VastService } from './vast.service';

describe('VastService', () => {
  let service: VastService;
  const http = {
    post: jest.fn(),
    get: jest.fn(),
  };
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      VAST_ENABLED: 'true',
      VAST_GENERATE_VIDEO_WAN_URL: 'https://vast.example/wan',
      VAST_HEALTHCHECK_URL: 'https://vast.example/health',
      VAST_REQUEST_TIMEOUT_MS: '123456',
    };
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VastService,
        {
          provide: HttpService,
          useValue: http,
        },
      ],
    }).compile();

    service = module.get<VastService>(VastService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('uses VAST_GENERATE_VIDEO_WAN_URL and timeout from env', async () => {
    http.post.mockReturnValue(
      of({
        status: 200,
        data: { status: 'ok' },
      }),
    );

    await service.generateVideo({
      prompt: 'prompt',
      inputImageUrl: 'https://signed.example/input.png',
      presetId: 'standard_wan22_ti2v',
      modelName: 'wan2.2-ti2v-standard',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://vast.example/wan',
      expect.objectContaining({
        prompt: 'prompt',
      }),
      expect.objectContaining({
        timeout: 123456,
        proxy: false,
      }),
    );
  });

  it('fails fast when VAST endpoint is missing', async () => {
    delete process.env.VAST_GENERATE_VIDEO_WAN_URL;

    await expect(
      service.generateVideo({
        prompt: 'prompt',
        inputImageUrl: 'https://signed.example/input.png',
      }),
    ).rejects.toThrow('VAST_GENERATE_VIDEO_WAN_URL is missing');
  });

  it('marks billing-limit 429 as non-retryable', async () => {
    http.post.mockReturnValue(
      throwError(() => ({
        isAxiosError: true,
        message: 'Request failed with status code 429',
        response: {
          status: 429,
          data: 'workspace billing cycle spend limit reached',
        },
      })),
    );

    await expect(
      service.generateVideo({
        prompt: 'prompt',
      }),
    ).rejects.toMatchObject({
      statusCode: 429,
      retryable: false,
      errorType: 'TRANSIENT_INFRA',
    });
  });

  it('marks OOM-like responses as transient OOM', async () => {
    http.post.mockReturnValue(
      throwError(() => ({
        isAxiosError: true,
        message: 'Request failed with status code 500',
        response: {
          status: 500,
          data: 'CUDA out of memory on worker',
        },
      })),
    );

    await expect(
      service.generateVideo({
        prompt: 'prompt',
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      retryable: true,
      errorType: 'TRANSIENT_OOM',
    });
  });

  it('healthcheck returns false when service is disabled', async () => {
    process.env.VAST_ENABLED = 'false';
    await expect(service.healthcheck()).resolves.toBe(false);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('healthcheck returns true when URL is missing but service enabled', async () => {
    delete process.env.VAST_HEALTHCHECK_URL;
    await expect(service.healthcheck()).resolves.toBe(true);
  });

  it('healthcheck returns true on 2xx', async () => {
    http.get.mockReturnValue(of({ status: 200 }));
    await expect(service.healthcheck()).resolves.toBe(true);
  });

  it('healthcheck returns false on request error', async () => {
    http.get.mockReturnValue(throwError(() => new Error('network error')));
    await expect(service.healthcheck()).resolves.toBe(false);
  });

  it('returns buffer from video_base64', async () => {
    const expected = Buffer.from('hello world');
    const buffer = await service.getVideoBuffer({
      video_base64: expected.toString('base64'),
    });

    expect(buffer.equals(expected)).toBe(true);
  });

  it('downloads buffer from video_url when base64 is missing', async () => {
    const expected = Buffer.from('video bytes');
    http.get.mockReturnValue(of({ data: expected }));

    const buffer = await service.getVideoBuffer({
      video_url: 'https://cdn.example/video.mp4',
    });

    expect(http.get).toHaveBeenCalledWith(
      'https://cdn.example/video.mp4',
      expect.objectContaining({
        responseType: 'arraybuffer',
        timeout: 10 * 60 * 1000,
        proxy: false,
      }),
    );
    expect(buffer.equals(expected)).toBe(true);
  });
});

