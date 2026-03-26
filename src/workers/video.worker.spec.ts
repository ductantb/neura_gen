import { JobStatus } from '@prisma/client';
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

  let worker: VideoWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new VideoWorker(
      prisma as any,
      modal as any,
      storageService as any,
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
  });
});
