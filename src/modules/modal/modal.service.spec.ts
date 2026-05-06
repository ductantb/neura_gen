import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ModalService } from './modal.service';
import { of, throwError } from 'rxjs';
import { StructuredLoggerService } from 'src/infra/logging/structured-logger.service';

describe('ModalService', () => {
  let service: ModalService;
  const http = {
    post: jest.fn(),
    get: jest.fn(),
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      MODAL_GENERATE_VIDEO_URL: 'https://modal.example/ltx',
      MODAL_GENERATE_VIDEO_TURBO_WAN_URL: 'https://modal.example/turbo-wan',
      MODAL_GENERATE_VIDEO_WAN_URL: 'https://modal.example/wan',
      MODAL_GENERATE_VIDEO_HUNYUAN_URL: 'https://modal.example/hunyuan',
    };
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModalService,
        {
          provide: HttpService,
          useValue: http,
        },
        {
          provide: StructuredLoggerService,
          useValue: logger,
        },
      ],
    }).compile();

    service = module.get<ModalService>(ModalService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('routes the preview preset to the default LTX endpoint', async () => {
    http.post.mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: { status: 'ok' },
      }),
    );

    await service.generateVideo({
      prompt: 'prompt',
      inputImageUrl: 'https://signed.example/input.png',
      presetId: 'preview_ltx_i2v',
      modelName: 'ltx-video-i2v-preview',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://modal.example/ltx',
      expect.any(Object),
      expect.objectContaining({
        timeout: 10 * 60 * 1000,
        proxy: false,
      }),
    );
  });

  it('routes the Wan preset to the dedicated Wan endpoint with a longer timeout', async () => {
    http.post.mockReturnValue(
      of({
        status: 200,
        headers: {},
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
      'https://modal.example/wan',
      expect.any(Object),
      expect.objectContaining({
        timeout: 45 * 60 * 1000,
        proxy: false,
      }),
    );
  });

  it('allows Wan preset payload without input image URL (text-only T2V mode)', async () => {
    http.post.mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: { status: 'ok' },
      }),
    );

    await service.generateVideo({
      prompt: 'prompt',
      presetId: 'standard_wan22_ti2v',
      modelName: 'wan2.2-ti2v-standard',
      workflow: 'T2V',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://modal.example/wan',
      expect.objectContaining({
        prompt: 'prompt',
        workflow: 'T2V',
      }),
      expect.objectContaining({
        timeout: 45 * 60 * 1000,
        proxy: false,
      }),
    );
  });

  it('surfaces non-retryable billing-limit responses with a rich error message', async () => {
    http.post.mockReturnValue(
      throwError(() => ({
        isAxiosError: true,
        message: 'Request failed with status code 429',
        response: {
          status: 429,
          data: 'modal-http: Webhook failed: workspace billing cycle spend limit reached',
        },
      })),
    );

    await expect(
      service.generateVideo({
        prompt: 'prompt',
        presetId: 'standard_wan22_ti2v',
        modelName: 'wan2.2-ti2v-standard',
        workflow: 'T2V',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('billing cycle spend limit reached'),
      statusCode: 429,
      retryable: false,
    });
  });

  it('fails fast when a requested provider route is not configured', async () => {
    delete process.env.MODAL_GENERATE_VIDEO_HUNYUAN_URL;

    await expect(
      service.generateVideo({
        prompt: 'prompt',
        inputImageUrl: 'https://signed.example/input.png',
        presetId: 'quality_hunyuan_i2v',
        modelName: 'hunyuan-video-i2v-quality',
      }),
    ).rejects.toThrow('MODAL_GENERATE_VIDEO_HUNYUAN_URL is missing');
  });

  it('routes the Hunyuan preset to the dedicated Hunyuan endpoint with the longest timeout', async () => {
    http.post.mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: { status: 'ok' },
      }),
    );

    await service.generateVideo({
      prompt: 'prompt',
      inputImageUrl: 'https://signed.example/input.png',
      presetId: 'quality_hunyuan_i2v',
      modelName: 'hunyuan-video-i2v-quality',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://modal.example/hunyuan',
      expect.any(Object),
      expect.objectContaining({
        timeout: 60 * 60 * 1000,
        proxy: false,
      }),
    );
  });

  it('routes the Wan 8s preset to the dedicated Wan endpoint with the longest Wan timeout', async () => {
    http.post.mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: { status: 'ok' },
      }),
    );

    await service.generateVideo({
      prompt: 'prompt',
      inputImageUrl: 'https://signed.example/input.png',
      presetId: 'standard_wan22_ti2v_8s',
      modelName: 'wan2.2-ti2v-standard',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://modal.example/wan',
      expect.any(Object),
      expect.objectContaining({
        timeout: 60 * 60 * 1000,
        proxy: false,
      }),
    );
  });

  it('allows the Wan 8s preset payload without input image URL (text-only T2V mode)', async () => {
    http.post.mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: { status: 'ok' },
      }),
    );

    await service.generateVideo({
      prompt: 'prompt',
      presetId: 'standard_wan22_ti2v_8s',
      modelName: 'wan2.2-ti2v-standard',
      workflow: 'T2V',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://modal.example/wan',
      expect.objectContaining({
        prompt: 'prompt',
        presetId: 'standard_wan22_ti2v_8s',
        workflow: 'T2V',
      }),
      expect.objectContaining({
        timeout: 60 * 60 * 1000,
        proxy: false,
      }),
    );
  });

  it('routes the Turbo Wan preset to the dedicated turbo endpoint with a medium timeout', async () => {
    http.post.mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: { status: 'ok' },
      }),
    );

    await service.generateVideo({
      prompt: 'prompt',
      inputImageUrl: 'https://signed.example/input.png',
      presetId: 'turbo_wan22_i2v_a14b',
      modelName: 'wan2.2-i2v-a14b-turbo',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://modal.example/turbo-wan',
      expect.any(Object),
      expect.objectContaining({
        timeout: 20 * 60 * 1000,
        proxy: false,
      }),
    );
  });
});
