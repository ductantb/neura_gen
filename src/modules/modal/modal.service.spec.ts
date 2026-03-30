import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ModalService } from './modal.service';
import { of } from 'rxjs';

describe('ModalService', () => {
  let service: ModalService;
  const http = {
    post: jest.fn(),
    get: jest.fn(),
  };
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      MODAL_GENERATE_VIDEO_URL: 'https://modal.example/ltx',
      MODAL_GENERATE_VIDEO_WAN_URL: 'https://modal.example/wan',
    };
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModalService,
        {
          provide: HttpService,
          useValue: http,
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
        timeout: 60 * 60 * 1000,
      }),
    );
  });

  it('routes the Wan budget preset to the Wan endpoint with a shorter timeout', async () => {
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
      presetId: 'budget_wan22_ti2v',
      modelName: 'wan2.2-ti2v-standard',
    });

    expect(http.post).toHaveBeenCalledWith(
      'https://modal.example/wan',
      expect.any(Object),
      expect.objectContaining({
        timeout: 35 * 60 * 1000,
      }),
    );
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
});
