import { ServiceUnavailableException } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service';
import { VIDEO_QUEUE } from 'src/common/constants';

describe('JobsService', () => {
  let service: JobsService;

  const prisma = {
    asset: {
      findUnique: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();

    service = new JobsService(
      prisma as any,
      storageService as any,
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
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          userCredit: {
            findUnique: jest.fn().mockResolvedValue({ userId: 'user-1', balance: 100 }),
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
      modelName: 'wan2.2-i2v-standard',
    };
    const createJob = jest.fn().mockResolvedValue(createdJob);

    prisma.asset.findUnique.mockResolvedValue(inputAsset);
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) =>
        callback({
          userCredit: {
            findUnique: jest.fn().mockResolvedValue({ userId: 'user-1', balance: 100 }),
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
      presetId: 'standard_wan22_i2v',
    });

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'modal',
          modelName: 'wan2.2-i2v-standard',
          turboEnabled: false,
          extraConfig: expect.objectContaining({
            presetId: 'standard_wan22_i2v',
            workflow: 'I2V',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: 'modal',
        modelName: 'wan2.2-i2v-standard',
        presetId: 'standard_wan22_i2v',
      }),
    );
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
  });
});
