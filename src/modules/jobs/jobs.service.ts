import { BadRequestException, Inject, Injectable, NotFoundException,} from '@nestjs/common';
import { AssetRole, JobStatus, JobType, CreditReason } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { VIDEO_QUEUE } from 'src/common/constants';
import { CreateVideoJobDto } from './dto/create-job.dto';
import { StorageService } from 'src/infra/storage/storage.service';

@Injectable()
export class JobsService {

  private readonly VIDEO_JOB_CREDIT_COST =  10; // Admin không bị trừ credit

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    @Inject(VIDEO_QUEUE) private readonly videoQueue: Queue,
  ) {}

  async createVideoJob(userId: string, dto: CreateVideoJobDto) {
  const inputAsset = await this.prisma.asset.findUnique({
    where: { id: dto.inputAssetId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  if (!inputAsset) {
    throw new NotFoundException('Input asset not found');
  }

  if (inputAsset.userId !== userId) {
    throw new BadRequestException('Input asset does not belong to the user');
  }

  if (inputAsset.role !== AssetRole.INPUT) {
    throw new BadRequestException("Asset role must be 'INPUT'");
  }

  if (inputAsset.versions.length === 0) {
    throw new BadRequestException('Input asset has no versions');
  }

  

  const result = await this.prisma.$transaction(async (tx) => {
    const wallet = await tx.userCredit.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('User credit wallet not found');
    }

    if (wallet.balance < this.VIDEO_JOB_CREDIT_COST) {
      throw new BadRequestException('Not enough credit');
    }

    await tx.userCredit.update({
      where: { userId },
      data: {
        balance: {
          decrement: this.VIDEO_JOB_CREDIT_COST,
        },
      },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -this.VIDEO_JOB_CREDIT_COST,
        reason: CreditReason.CREATE_IMAGE_TO_VIDEO_JOB,
        metadata: {
          inputAssetId: dto.inputAssetId,
          prompt: dto.prompt,
        },
      },
    });

    const job = await tx.generateJob.create({
      data: {
        userId,
        type: JobType.IMAGE_TO_VIDEO,
        status: JobStatus.PENDING,
        prompt: dto.prompt,
        negativePrompt: dto.negativePrompt,
        modelName: 'default-model',
        turboEnabled: false,
        progress: 0,
        creditCost: this.VIDEO_JOB_CREDIT_COST,
        extraConfig: {
          inputAssetId: dto.inputAssetId,
        },
        assets: {
          connect: [{ id: inputAsset.id }],
        },
        logs: {
          create: [
            { message: 'Job created' },
            { message: `Input asset: ${inputAsset.id}` },
            { message: `Credit charged: ${this.VIDEO_JOB_CREDIT_COST}` },
          ],
        },
      },
    });

    await tx.asset.update({
      where: { id: inputAsset.id },
      data: { jobId: job.id },
    });

    await tx.generateJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.QUEUED,
        progress: 1,
      },
    });

    return job;
  });

  await this.videoQueue.add(
    'generate-video',
    { jobId: result.id },
    {
      jobId: result.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  );

  return {
    jobId: result.id,
    status: JobStatus.QUEUED,
    creditCost: result.creditCost,
  };
}

  async listMyJobs(userId: string) {
    const jobs = await this.prisma.generateJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        assets: {
          include: {
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
        },
      },
    });


    return Promise.all(
      jobs.map(async (job) => {
        const outputAsset = job.assets.find((a) => a.role === AssetRole.OUTPUT);
        const latestOutputVersion = outputAsset?.versions?.[0];
        
        // có thể sửa sau 
        let output: any = null;

        if (latestOutputVersion) {
          const signed = await this.storageService.getDownloadSignedUrl(
            latestOutputVersion.objectKey,
            3600,
          );

          output = {
            assetId: outputAsset?.id,
            mimeType: latestOutputVersion.mimeType,
            downloadUrl: signed.url,
            expiresIn: signed.expiresIn,
          };
        }

        const thumbnailAsset = job.assets.find((a) => a.role === AssetRole.THUMBNAIL);
        const latestThumbnailVersion = thumbnailAsset?.versions?.[0];

          // có thể sửa sau
          let thumbnail: any = null;

          if (latestThumbnailVersion) {
            const signedThumb = await this.storageService.getDownloadSignedUrl(
              latestThumbnailVersion.objectKey,
              3600,
            );

            thumbnail = {
              assetId: thumbnailAsset?.id,
              mimeType: latestThumbnailVersion.mimeType,
              downloadUrl: signedThumb.url,
              expiresIn: signedThumb.expiresIn,
            };
          }

        return {
          id: job.id,
          type: job.type,
          status: job.status,
          progress: job.progress,
          prompt: job.prompt,
          modelName: job.modelName,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          output,
          thumbnail,
        };
      }),
    );
  }

  async getJobWithAssets(userId: string, id: string) {
    const job = await this.prisma.generateJob.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        assets: {
          include: {
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
        },
        logs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const inputAssets = job.assets.filter((a) => a.role === AssetRole.INPUT);
    const outputAssets = job.assets.filter((a) => a.role === AssetRole.OUTPUT);

    const output = await this.buildOutputResult(outputAssets[0]);

    const thumbnailAssets = job.assets.filter((a) => a.role === AssetRole.THUMBNAIL);
    const thumbnail = await this.buildOutputResult(thumbnailAssets[0]);

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      modelName: job.modelName,
      creditCost: job.creditCost,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      failedAt: job.failedAt,
      inputAssets,
      outputAssets,
      output,
      logs: job.logs,
      thumbnailAssets,
      thumbnail,
    };
  }

  async getJobResult(userId: string, id: string) {
    const job = await this.prisma.generateJob.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        assets: {
          include: {
            versions: {
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const outputAsset = job.assets.find((a) => a.role === AssetRole.OUTPUT);

    if (!outputAsset) {
      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        creditCost: job.creditCost,
        resultReady: false,
      };
    }

    const latestVersion = outputAsset.versions[0];
    if (!latestVersion) {
      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        creditCost: job.creditCost,
        resultReady: false,
      };
    }

    const signed = await this.storageService.getDownloadSignedUrl(
      latestVersion.objectKey,
      3600,
    );

    const thumbnailAsset = job.assets.find((a) => a.role === AssetRole.THUMBNAIL);
    const thumbnailVersion = thumbnailAsset?.versions?.[0];

    let thumbnail: {
      assetId: string;
      bucket: string;
      objectKey: string;
      mimeType: string | null;
      sizeBytes: number | null;
      downloadUrl: string;
      expiresIn: number;
      createdAt: Date;
    } | null = null;

    if (thumbnailVersion) {
      const signedThumb = await this.storageService.getDownloadSignedUrl(
        thumbnailVersion.objectKey,
        3600,
      );

      thumbnail = {
        assetId: thumbnailAsset!.id,
        bucket: thumbnailVersion.bucket,
        objectKey: thumbnailVersion.objectKey,
        mimeType: thumbnailVersion.mimeType,
        sizeBytes: thumbnailVersion.sizeBytes,
        downloadUrl: signedThumb.url,
        expiresIn: signedThumb.expiresIn,
        createdAt: thumbnailVersion.createdAt,
      };
    }

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      creditCost: job.creditCost,
      resultReady: job.status === JobStatus.COMPLETED,
      assetId: outputAsset.id,
      bucket: latestVersion.bucket,
      objectKey: latestVersion.objectKey,
      mimeType: latestVersion.mimeType,
      sizeBytes: latestVersion.sizeBytes,
      downloadUrl: signed.url,
      expiresIn: signed.expiresIn,
      createdAt: latestVersion.createdAt,
      thumbnail,
    };
  }

  private async buildOutputResult(outputAsset?: {
    id: string;
    versions: Array<{
      bucket: string;
      objectKey: string;
      mimeType: string | null;
      sizeBytes: number | null;
      createdAt: Date;
    }>;
  }) {
    if (!outputAsset) return null;

    const latestVersion = outputAsset.versions?.[0];
    if (!latestVersion) return null;

    const signed = await this.storageService.getDownloadSignedUrl(
      latestVersion.objectKey,
      3600,
    );

    return {
      assetId: outputAsset.id,
      bucket: latestVersion.bucket,
      objectKey: latestVersion.objectKey,
      mimeType: latestVersion.mimeType,
      sizeBytes: latestVersion.sizeBytes,
      downloadUrl: signed.url,
      expiresIn: signed.expiresIn,
      createdAt: latestVersion.createdAt,
    };
  }

  
  async cancelJob(userId: string, jobId: string) {
  const job = await this.prisma.generateJob.findFirst({
    where: { id: jobId, userId },
  });

  if (!job) {
    throw new NotFoundException('Job not found');
  }

  if (job.status === JobStatus.COMPLETED) {
    throw new BadRequestException('Completed job cannot be canceled');
  }

  if (job.status === JobStatus.FAILED) {
    throw new BadRequestException('Failed job cannot be canceled');
  }

  if (job.status === JobStatus.CANCELLED) {
    throw new BadRequestException('Job already canceled');
  }

  if (job.status === JobStatus.PROCESSING) {
    throw new BadRequestException('Processing job cannot be canceled');
  }

  // 🔥 remove khỏi queue
  const bullJob = await this.videoQueue.getJob(job.id);
  if (bullJob) {
    await bullJob.remove();
  }

  await this.prisma.$transaction(async (tx) => {
    // update job
    await tx.generateJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.CANCELLED,
        progress: 0,
        failedAt: new Date(),
        errorMessage: 'Cancelled by user',
      },
    });

    // refund credit nếu có
    if (job.creditCost > 0) {
      const existingRefund = await tx.creditTransaction.findFirst({
        where: {
          userId: job.userId,
          reason: CreditReason.REFUND_CANCELED_JOB,
          metadata: {
            path: ['jobId'],
            equals: job.id,
          },
        },
      });

      if (!existingRefund) {
        await tx.userCredit.update({
          where: { userId: job.userId },
          data: {
            balance: {
              increment: job.creditCost,
            },
          },
        });

        await tx.creditTransaction.create({
          data: {
            userId: job.userId,
            amount: job.creditCost,
            reason: CreditReason.REFUND_CANCELED_JOB,
            metadata: {
              jobId: job.id,
            },
          },
        });
      }
    }

    // log
    await tx.jobLog.create({
      data: {
        jobId: job.id,
        message: 'Job canceled by user',
      },
    });
  });

  return {
    jobId: job.id,
    status: JobStatus.CANCELLED,
    refundedCredit: job.creditCost,
  };
}
}