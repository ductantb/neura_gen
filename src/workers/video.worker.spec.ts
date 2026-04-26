import { JobStatus } from '@prisma/client';
import { JobEventsService } from 'src/modules/jobs/job-events.service';
import { VideoWorker } from './video.worker';

describe('VideoWorker', () => {
  const prisma = {
    jobLog: {
      create: jest.fn(),
    },
    generateJob: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    asset: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    assetVersion: {
      create: jest.fn(),
    },
    creditTransaction: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    userCredit: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const modal = {
    generateVideo: jest.fn(),
    getVideoBuffer: jest.fn(),
  };

  const storageService = {
    getDownloadSignedUrl: jest.fn(),
    upload: jest.fn(),
    delete: jest.fn(),
  };

  const jobEvents = {
    emitStatus: jest.fn(),
    emitLog: jest.fn(),
  };

  let worker: VideoWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.jobLog.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        jobId: data.jobId,
        message: data.message,
        createdAt: new Date('2026-03-31T00:00:00.000Z'),
      }),
    );
    worker = new VideoWorker(
      prisma as any,
      modal as any,
      storageService as any,
      jobEvents as unknown as JobEventsService,
    );

    prisma.generateJob.findUnique.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      prompt: 'prompt',
      negativePrompt: null,
      provider: 'modal',
      modelName: 'model',
      creditCost: 10,
      status: JobStatus.QUEUED,
      progress: 1,
      extraConfig: {
        inputAssetId: 'asset-1',
        presetId: 'preview_ltx_i2v',
        workflow: 'I2V',
      },
    });
    prisma.asset.findUnique.mockResolvedValue({
      id: 'asset-1',
      versions: [{ objectKey: 'input.png' }],
    });
    prisma.asset.findMany.mockResolvedValue([]);
    storageService.getDownloadSignedUrl.mockResolvedValue({
      url: 'https://signed.example/input.png',
      expiresIn: 3600,
    });
    prisma.generateJob.update.mockImplementation(({ where, data }: any) =>
      Promise.resolve({
        id: where.id,
        status: data.status,
        progress: data.progress,
        errorMessage: data.errorMessage ?? null,
        startedAt: data.startedAt ?? null,
        completedAt: data.completedAt ?? null,
        failedAt: data.failedAt ?? null,
        updatedAt: new Date('2026-03-31T00:00:00.000Z'),
      }),
    );
  });

  it('requeues a failed job before the final attempt without refunding credits', async () => {
    modal.generateVideo.mockRejectedValue(new Error('provider timeout'));

    await expect(
      worker['handle']({
        data: { jobId: 'job-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow('provider timeout');

    expect(modal.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        provider: 'modal',
        presetId: 'preview_ltx_i2v',
        workflow: 'I2V',
      }),
    );
    expect(prisma.generateJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: JobStatus.QUEUED,
        }),
      }),
    );
    expect(jobEvents.emitStatus).toHaveBeenCalled();
    expect(jobEvents.emitLog).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        message: expect.stringContaining('retrying'),
      }),
    );
    expect(prisma.creditTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('refunds credits only on the final failed attempt', async () => {
    modal.generateVideo.mockRejectedValue(new Error('provider timeout'));
    prisma.creditTransaction.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        userCredit: {
          update: prisma.userCredit.update,
        },
        creditTransaction: {
          create: prisma.creditTransaction.create,
        },
      }),
    );

    await expect(
      worker['handle']({
        data: { jobId: 'job-1' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow('provider timeout');

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
    expect(jobEvents.emitStatus).toHaveBeenCalled();
    expect(jobEvents.emitLog).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        message: expect.stringContaining('failed permanently'),
      }),
    );
  });

  it('supports TI2V text-only jobs without resolving input image URL', async () => {
    prisma.generateJob.findUnique.mockResolvedValue({
      id: 'job-text-only',
      userId: 'user-1',
      prompt: 'prompt',
      negativePrompt: null,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
      creditCost: 10,
      status: JobStatus.QUEUED,
      progress: 1,
      extraConfig: {
        presetId: 'standard_wan22_ti2v',
        workflow: 'TI2V',
        includeBackgroundAudio: false,
      },
    });
    prisma.asset.findFirst.mockResolvedValue(null);
    modal.generateVideo.mockRejectedValue(new Error('provider timeout'));

    await expect(
      worker['handle']({
        data: { jobId: 'job-text-only' },
        attemptsMade: 0,
        opts: { attempts: 2 },
      } as any),
    ).rejects.toThrow('provider timeout');

    expect(storageService.getDownloadSignedUrl).not.toHaveBeenCalled();
    expect(modal.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: 'TI2V',
        inputImageUrl: undefined,
      }),
    );
  });
});
