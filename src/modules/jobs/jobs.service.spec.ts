import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { JobEventsService } from './job-events.service';
import { JobsService } from './jobs.service';
import { VIDEO_QUEUE } from 'src/common/constants';

describe('JobsService', () => {
  let service: JobsService;
  const now = new Date('2026-03-31T00:00:00.000Z');

  const prisma = {
    asset: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    userDailyUsage: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    userCredit: {
      update: jest.fn(),
    },
    creditTransaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    generateJob: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    jobLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const storageService = {
    getDownloadSignedUrl: jest.fn(),
  };

  const videoQueue = {
    add: jest.fn(),
    getJob: jest.fn(),
  };

  const jobEvents = {
    emitStatus: jest.fn(),
    emitLog: jest.fn(),
    emitSnapshot: jest.fn(),
    emitNotification: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'FREE',
      proExpiresAt: null,
    });
    prisma.userDailyUsage.upsert.mockResolvedValue({
      userId: 'user-1',
      dateKey: '2026-03-31',
      premiumFreeCreditsUsed: 0,
    });
    prisma.userDailyUsage.update.mockResolvedValue({
      userId: 'user-1',
      dateKey: '2026-03-31',
      premiumFreeCreditsUsed: 0,
    });
    prisma.jobLog.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        jobId: data.jobId,
        message: data.message,
        createdAt: now,
      }),
    );

    service = new JobsService(
      prisma as any,
      storageService as any,
      jobEvents as unknown as JobEventsService,
      videoQueue as any,
    );
  });

  it('refunds and marks the job failed when queue enqueue fails', async () => {
    const inputAsset = {
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    };
    const createdJob = {
      id: 'job-1',
      userId: 'user-1',
      creditCost: 10,
      provider: 'modal',
      modelName: 'ltx-video-i2v-preview',
    };

    prisma.asset.findUnique.mockResolvedValue(inputAsset);
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-1',
      status: JobStatus.FAILED,
      progress: 0,
      errorMessage: 'Queue enqueue failed: redis down',
      startedAt: null,
      completedAt: null,
      failedAt: now,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: jest.fn().mockResolvedValue(createdJob),
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          creditTransaction: {
            findFirst: prisma.creditTransaction.findFirst,
            create: prisma.creditTransaction.create,
          },
          userCredit: {
            update: prisma.userCredit.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockRejectedValue(new Error('redis down'));
    prisma.creditTransaction.findFirst.mockResolvedValue(null);

    await expect(
      service.createVideoJob('user-1', {
        inputAssetId: 'asset-1',
        prompt: 'prompt',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.generateJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: JobStatus.FAILED,
        }),
      }),
    );
    expect(prisma.userCredit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        data: {
          balance: {
            increment: 10,
          },
        },
      }),
    );
    expect(jobEvents.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        jobId: 'job-1',
        kind: 'JOB_FAILED',
      }),
    );
  });

  it('uses the selected preset metadata when creating a video job', async () => {
    const inputAsset = {
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    };
    const createdJob = {
      id: 'job-2',
      userId: 'user-1',
      creditCost: 10,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);

    prisma.asset.findUnique.mockResolvedValue(inputAsset);
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-2',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-2' });

    const result = await service.createVideoJob('user-1', {
      inputAssetId: 'asset-1',
      prompt: 'prompt',
      presetId: 'standard_wan22_ti2v',
    });

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'modal',
          modelName: 'wan2.2-ti2v-standard',
          turboEnabled: false,
          extraConfig: expect.objectContaining({
            presetId: 'standard_wan22_ti2v',
            workflow: 'I2V',
            presetWorkflow: 'TI2V',
            inputMode: 'I2V',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'modal',
        modelName: 'wan2.2-ti2v-standard',
        presetId: 'standard_wan22_ti2v',
      }),
    );
    expect(jobEvents.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        jobId: 'job-2',
        kind: 'JOB_QUEUED',
      }),
    );
  });

  it('uses the default Wan TI2V preset when no preset is provided', async () => {
    const inputAsset = {
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    };
    const createdJob = {
      id: 'job-budget',
      userId: 'user-1',
      creditCost: 10,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);

    prisma.asset.findUnique.mockResolvedValue(inputAsset);
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-budget',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-budget' });

    const result = await service.createVideoJob('user-1', {
      inputAssetId: 'asset-1',
      prompt: 'prompt',
    });

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          modelName: 'wan2.2-ti2v-standard',
          extraConfig: expect.objectContaining({
            presetId: 'standard_wan22_ti2v',
            workflow: 'I2V',
            presetWorkflow: 'TI2V',
            inputMode: 'I2V',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        presetId: 'standard_wan22_ti2v',
      }),
    );
  });

  it('allows creating a Wan TI2V job without inputAssetId for text-only generation', async () => {
    const createdJob = {
      id: 'job-text-only',
      userId: 'user-1',
      creditCost: 10,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);

    prisma.generateJob.update.mockResolvedValue({
      id: 'job-text-only',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-text-only' });

    const result = await service.createVideoJob('user-1', {
      prompt: 'prompt',
    });

    expect(prisma.asset.findUnique).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          extraConfig: expect.objectContaining({
            presetId: 'standard_wan22_ti2v',
            workflow: 'T2V',
            presetWorkflow: 'TI2V',
            inputMode: 'T2V',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        presetId: 'standard_wan22_ti2v',
      }),
    );
  });

  it('allows creating the Wan TI2V 8s preset without inputAssetId for text-only generation', async () => {
    const createdJob = {
      id: 'job-text-only-8s',
      userId: 'user-1',
      creditCost: 14,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);

    prisma.generateJob.update.mockResolvedValue({
      id: 'job-text-only-8s',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-text-only-8s' });

    const result = await service.createVideoJob('user-1', {
      prompt: 'prompt',
      presetId: 'standard_wan22_ti2v_8s',
    });

    expect(prisma.asset.findUnique).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creditCost: 14,
          extraConfig: expect.objectContaining({
            presetId: 'standard_wan22_ti2v_8s',
            workflow: 'T2V',
            presetWorkflow: 'TI2V',
            inputMode: 'T2V',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        presetId: 'standard_wan22_ti2v_8s',
      }),
    );
  });

  it('rejects I2V presets when inputAssetId is missing', async () => {
    await expect(
      service.createVideoJob('user-1', {
        prompt: 'prompt',
        presetId: 'preview_ltx_i2v',
      }),
    ).rejects.toThrow('requires inputAssetId');
  });

  it('stores includeBackgroundAudio=false when user disables background audio', async () => {
    const inputAsset = {
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    };
    const createdJob = {
      id: 'job-no-audio',
      userId: 'user-1',
      creditCost: 10,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);

    prisma.asset.findUnique.mockResolvedValue(inputAsset);
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-no-audio',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-no-audio' });

    const result = await service.createVideoJob('user-1', {
      inputAssetId: 'asset-1',
      prompt: 'prompt',
      presetId: 'standard_wan22_ti2v',
      includeBackgroundAudio: false,
    });

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          extraConfig: expect.objectContaining({
            includeBackgroundAudio: false,
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        includeBackgroundAudio: false,
      }),
    );
  });

  it('stores the 8s Wan preset metadata when selected explicitly', async () => {
    const inputAsset = {
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    };
    const createdJob = {
      id: 'job-wan-8s',
      userId: 'user-1',
      creditCost: 14,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);

    prisma.asset.findUnique.mockResolvedValue(inputAsset);
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-wan-8s',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-wan-8s' });

    const result = await service.createVideoJob('user-1', {
      inputAssetId: 'asset-1',
      prompt: 'prompt',
      presetId: 'standard_wan22_ti2v_8s',
    });

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'modal',
          modelName: 'wan2.2-ti2v-standard',
          turboEnabled: false,
          creditCost: 14,
          extraConfig: expect.objectContaining({
            presetId: 'standard_wan22_ti2v_8s',
            workflow: 'I2V',
            presetWorkflow: 'TI2V',
            inputMode: 'I2V',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'modal',
        modelName: 'wan2.2-ti2v-standard',
        presetId: 'standard_wan22_ti2v_8s',
        estimatedDurationSeconds: 660,
      }),
    );
  });

  it('charges the higher quality preset cost only when Hunyuan is selected explicitly', async () => {
    const inputAsset = {
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    };
    const createdJob = {
      id: 'job-hunyuan',
      userId: 'user-1',
      creditCost: 20,
      provider: 'modal',
      modelName: 'hunyuan-video-i2v-quality',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'PRO',
      proExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    prisma.userDailyUsage.upsert.mockResolvedValue({
      userId: 'user-1',
      dateKey: '2026-03-31',
      premiumFreeCreditsUsed: 20,
    });

    prisma.asset.findUnique.mockResolvedValue(inputAsset);
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-hunyuan',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-hunyuan' });

    const result = await service.createVideoJob('user-1', {
      inputAssetId: 'asset-1',
      prompt: 'prompt',
      presetId: 'quality_hunyuan_i2v',
    });

    expect(prisma.userCredit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          balance: {
            decrement: 20,
          },
        },
      }),
    );
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creditCost: 20,
          turboEnabled: false,
          extraConfig: expect.objectContaining({
            presetId: 'quality_hunyuan_i2v',
            workflow: 'I2V',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        presetId: 'quality_hunyuan_i2v',
        tier: 'quality',
        estimatedDurationSeconds: 1320,
      }),
    );
  });

  it('keeps Turbo Wan explicit and stores turbo-specific metadata without changing the default preset', async () => {
    const inputAsset = {
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    };
    const createdJob = {
      id: 'job-turbo',
      userId: 'user-1',
      creditCost: 15,
      provider: 'modal',
      modelName: 'wan2.2-i2v-a14b-turbo',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'PRO',
      proExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    prisma.userDailyUsage.upsert.mockResolvedValue({
      userId: 'user-1',
      dateKey: '2026-03-31',
      premiumFreeCreditsUsed: 20,
    });

    prisma.asset.findUnique.mockResolvedValue(inputAsset);
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-turbo',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-turbo' });

    const result = await service.createVideoJob('user-1', {
      inputAssetId: 'asset-1',
      prompt: 'prompt',
      presetId: 'turbo_wan22_i2v_a14b',
    });

    expect(prisma.userCredit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          balance: {
            decrement: 15,
          },
        },
      }),
    );
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          modelName: 'wan2.2-i2v-a14b-turbo',
          turboEnabled: true,
          creditCost: 15,
          extraConfig: expect.objectContaining({
            presetId: 'turbo_wan22_i2v_a14b',
            workflow: 'I2V',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        presetId: 'turbo_wan22_i2v_a14b',
        tier: 'turbo',
        turboEnabled: true,
        estimatedDurationSeconds: 240,
      }),
    );
  });

  it('rejects premium presets for FREE users', async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    });
    prisma.$transaction.mockImplementationOnce(async (callback: any) =>
      callback({
        user: {
          findUnique: prisma.user.findUnique,
          update: prisma.user.update,
        },
        userDailyUsage: {
          upsert: prisma.userDailyUsage.upsert,
          update: prisma.userDailyUsage.update,
        },
        userCredit: {
          findUnique: jest.fn(),
          update: prisma.userCredit.update,
        },
        creditTransaction: {
          create: prisma.creditTransaction.create,
        },
        generateJob: {
          create: prisma.generateJob.create,
        },
      }),
    );

    await expect(
      service.createVideoJob('user-1', {
        inputAssetId: 'asset-1',
        prompt: 'prompt',
        presetId: 'turbo_wan22_i2v_a14b',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses daily free premium credits before charging wallet for PRO users', async () => {
    const createJob = jest.fn().mockResolvedValue({
      id: 'job-free-quota',
      userId: 'user-1',
      creditCost: 0,
      provider: 'modal',
      modelName: 'wan2.2-i2v-a14b-turbo',
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'PRO',
      proExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    prisma.userDailyUsage.upsert.mockResolvedValue({
      userId: 'user-1',
      dateKey: '2026-03-31',
      premiumFreeCreditsUsed: 5,
    });
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      userId: 'user-1',
      role: 'INPUT',
      versions: [{ objectKey: 'input.png' }],
    });
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-free-quota',
      status: JobStatus.QUEUED,
      progress: 1,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      updatedAt: now,
    });
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          user: {
            findUnique: prisma.user.findUnique,
            update: prisma.user.update,
          },
          userDailyUsage: {
            upsert: prisma.userDailyUsage.upsert,
            update: prisma.userDailyUsage.update,
          },
          userCredit: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ userId: 'user-1', balance: 100 }),
            update: prisma.userCredit.update,
          },
          creditTransaction: {
            create: prisma.creditTransaction.create,
          },
          generateJob: {
            create: createJob,
          },
        }),
      )
      .mockImplementationOnce(async (callback: any) =>
        callback({
          generateJob: {
            update: prisma.generateJob.update,
          },
          jobLog: {
            create: prisma.jobLog.create,
          },
        }),
      );
    videoQueue.add.mockResolvedValue({ id: 'job-free-quota' });

    const result = await service.createVideoJob('user-1', {
      inputAssetId: 'asset-1',
      prompt: 'prompt',
      presetId: 'turbo_wan22_i2v_a14b',
    });

    expect(prisma.userDailyUsage.update).toHaveBeenCalled();
    expect(prisma.userCredit.update).not.toHaveBeenCalled();
    expect(result.creditCost).toBe(0);
  });

  it('resolves input assets from extraConfig instead of job asset ownership', async () => {
    prisma.generateJob.findFirst.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      type: 'IMAGE_TO_VIDEO',
      status: 'QUEUED',
      progress: 1,
      prompt: 'prompt',
      negativePrompt: null,
      provider: 'modal',
      modelName: 'ltx-video-i2v-preview',
      creditCost: 10,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      extraConfig: {
        inputAssetId: 'asset-input',
        presetId: 'preview_ltx_i2v',
        workflow: 'I2V',
      },
      assets: [],
      logs: [],
    });
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-input',
      userId: 'user-1',
      role: 'INPUT',
      versions: [],
    });

    const result = await service.getJobWithAssets('user-1', 'job-1');

    expect(result.inputAssets).toEqual([
      expect.objectContaining({
        id: 'asset-input',
      }),
    ]);
    expect(result.presetId).toBe('preview_ltx_i2v');
    expect(result.workflow).toBe('I2V');
  });

  it('builds a lightweight stream snapshot with logs and preset metadata', async () => {
    prisma.generateJob.findFirst.mockResolvedValue({
      id: 'job-stream',
      userId: 'user-1',
      status: JobStatus.PROCESSING,
      progress: 60,
      errorMessage: null,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
      extraConfig: {
        presetId: 'standard_wan22_ti2v',
        workflow: 'T2V',
        presetWorkflow: 'TI2V',
      },
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      failedAt: null,
      logs: [
        {
          jobId: 'job-stream',
          message: 'Job queued',
          createdAt: now,
        },
      ],
    });

    const snapshot = await service.getJobStreamSnapshot('user-1', 'job-stream');

    expect(snapshot).toEqual(
      expect.objectContaining({
        jobId: 'job-stream',
        status: JobStatus.PROCESSING,
        progress: 60,
        provider: 'modal',
        modelName: 'wan2.2-ti2v-standard',
        presetId: 'standard_wan22_ti2v',
        workflow: 'T2V',
        logs: [
          {
            jobId: 'job-stream',
            message: 'Job queued',
            createdAt: now.toISOString(),
          },
        ],
      }),
    );
  });

  it('allows cancelling a processing job and refunds only once', async () => {
    prisma.generateJob.findFirst.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      status: JobStatus.PROCESSING,
      creditCost: 10,
    });
    videoQueue.getJob.mockResolvedValue({
      remove: jest.fn().mockRejectedValue(new Error('job active')),
    });
    prisma.creditTransaction.findFirst.mockResolvedValue(null);
    prisma.generateJob.update.mockResolvedValue({
      id: 'job-1',
      status: JobStatus.CANCELLED,
      progress: 50,
      errorMessage: 'Cancelled by user',
      startedAt: null,
      completedAt: null,
      failedAt: now,
      updatedAt: now,
    });
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        generateJob: {
          update: prisma.generateJob.update,
        },
        creditTransaction: {
          findFirst: prisma.creditTransaction.findFirst,
          create: prisma.creditTransaction.create,
        },
        userCredit: {
          update: prisma.userCredit.update,
        },
        jobLog: {
          create: prisma.jobLog.create,
        },
      }),
    );

    const result = await service.cancelJob('user-1', 'job-1');

    expect(result.status).toBe(JobStatus.CANCELLED);
    expect(prisma.generateJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: JobStatus.CANCELLED,
        }),
      }),
    );
    expect(prisma.userCredit.update).toHaveBeenCalledTimes(1);
    expect(jobEvents.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        jobId: 'job-1',
        kind: 'JOB_CANCELLED',
      }),
    );
  });
});
