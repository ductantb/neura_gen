import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  AssetRole,
  AssetType,
  CreditReason,
  JobStatus,
  Prisma,
} from '@prisma/client';
import { StorageService } from 'src/infra/storage/storage.service';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { ModalService } from 'src/modules/modal/modal.service';
import { generateThumbnailFromVideoBuffer } from 'src/utils/video-thumbnail.util';

class JobCancelledError extends Error {
  constructor(message = 'Job cancelled') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

@Injectable()
export class VideoWorker implements OnModuleDestroy {
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modal: ModalService,
    private readonly storageService: StorageService,
  ) {}

  // create job log
  private async log(jobId: string, message: string) {
    await this.prisma.jobLog.create({
      data: { jobId, message },
    });
  }

  // update job status and progress
  private async setStatus(
    jobId: string,
    status: JobStatus,
    progress: number,
    extra?: Partial<{
      errorMessage: string | null;
      startedAt: Date;
      completedAt: Date;
      failedAt: Date;
    }>,
  ) {
    await this.prisma.generateJob.update({
      where: { id: jobId },
      data: {
        status,
        progress,
        ...(extra ? extra : {}),
      },
    });
  }

  // initialize worker and listen to queue
  async start(redis: Redis): Promise<boolean> {
    if (process.env.RUN_WORKER !== 'true') {
      return false;
    }

    const queueName = process.env.VIDEO_QUEUE_NAME || 'video-gen';
    const concurrency = Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 2);

    this.worker = new Worker(
      queueName,
      async (bullJob: Job) => this.handle(bullJob),
      { connection: redis, concurrency },
    );

    this.worker.on('completed', () => {});
    this.worker.on('failed', () => {});

    return true;
  }

  // main job handler
  private async handle(bullJob: Job) {
    const { jobId } = bullJob.data as { jobId: string };

    const job = await this.prisma.generateJob.findUnique({
      where: { id: jobId },
    });

    if (!job) return;

    if (job.status === JobStatus.CANCELLED || job.status === JobStatus.COMPLETED) {
      return;
    }

    const uploadedKeys: string[] = [];
    let currentProgress = job.progress;

    const setStatus = async (
      status: JobStatus,
      progress: number,
      extra?: Partial<{
        errorMessage: string | null;
        startedAt: Date;
        completedAt: Date;
        failedAt: Date;
      }>,
    ) => {
      currentProgress = progress;
      await this.setStatus(jobId, status, progress, extra);
    };

    try {
      await this.ensureJobNotCancelled(jobId, 'Job cancelled before processing started');
      await this.cleanupOutputArtifacts(jobId);

      await setStatus(JobStatus.PROCESSING, 5, {
        startedAt: new Date(),
        errorMessage: null,
      });

      const inputAsset = await this.resolveInputAsset(job);
      if (!inputAsset) {
        throw new Error('Input asset not found for job');
      }

      const inputVersion = inputAsset.versions[0];
      if (!inputVersion) {
        throw new Error('Input asset has no versions');
      }

      await setStatus(JobStatus.PROCESSING, 15);

      const signedInputUrl = await this.storageService.getDownloadSignedUrl(
        inputVersion.objectKey,
        60 * 60,
      );

      await setStatus(JobStatus.PROCESSING, 30);
      await this.ensureJobNotCancelled(jobId, 'Job cancelled before provider request');

      const modalResponse = await this.modal.generateVideo({
        prompt: job.prompt,
        negativePrompt: job.negativePrompt ?? undefined,
        inputImageUrl: signedInputUrl.url,
        jobId: job.id,
        provider: job.provider ?? undefined,
        modelName: job.modelName ?? undefined,
        presetId: this.extractExtraConfigString(job.extraConfig, 'presetId') ?? undefined,
        userId: job.userId,
        workflow: this.extractExtraConfigString(job.extraConfig, 'workflow') ?? undefined,
      });

      await setStatus(JobStatus.PROCESSING, 60);
      await this.ensureJobNotCancelled(jobId, 'Job cancelled after provider response');

      const videoBuffer = await this.modal.getVideoBuffer(modalResponse);
      await setStatus(JobStatus.PROCESSING, 80);
      await this.ensureJobNotCancelled(jobId, 'Job cancelled before uploading outputs');

      const uploadResult = await this.storageService.upload({
        buffer: videoBuffer,
        mimeType: 'video/mp4',
        originalName: `generated-video-${jobId}.mp4`,
        folder: `jobs/${jobId}/output`,
        metadata: {
          jobId,
          userId: job.userId,
          type: AssetType.VIDEO,
          role: AssetRole.OUTPUT,
        },
      });
      uploadedKeys.push(uploadResult.key);

      await setStatus(JobStatus.PROCESSING, 90);
      await this.ensureJobNotCancelled(jobId, 'Job cancelled after video upload');

      const outputAsset = await this.prisma.asset.create({
        data: {
          userId: job.userId,
          jobId,
          type: 'VIDEO',
          role: 'OUTPUT',
          mimeType: 'video/mp4',
          originalName: `generated-video-${jobId}.mp4`,
        },
      });

      await setStatus(JobStatus.PROCESSING, 95);

      await this.prisma.assetVersion.create({
        data: {
          assetId: outputAsset.id,
          version: 1,
          bucket: uploadResult.bucket,
          objectKey: uploadResult.key,
          mimeType: 'video/mp4',
          originalName: `${jobId}.mp4`,
          sizeBytes: videoBuffer.length,
          metadata: {
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            modelName: job.modelName,
            sourceJobId: job.id,
            sourceInputAssetId: inputAsset.id,
            provider: 'modal',
          },
        },
      });

      const thumbnailBuffer = await generateThumbnailFromVideoBuffer(videoBuffer);
      await this.ensureJobNotCancelled(jobId, 'Job cancelled before thumbnail upload');

      const thumbnailUploadResult = await this.storageService.upload({
        buffer: thumbnailBuffer,
        mimeType: 'image/jpeg',
        originalName: `generated-thumbnail-${jobId}.jpg`,
        folder: `jobs/${jobId}/output`,
        metadata: {
          jobId,
          userId: job.userId,
          type: 'THUMBNAIL',
          role: 'THUMBNAIL',
        },
      });
      uploadedKeys.push(thumbnailUploadResult.key);

      const thumbnailAsset = await this.prisma.asset.create({
        data: {
          userId: job.userId,
          jobId,
          type: 'THUMBNAIL',
          role: 'THUMBNAIL',
          mimeType: 'image/jpeg',
          originalName: `generated-thumbnail-${jobId}.jpg`,
        },
      });

      await this.prisma.assetVersion.create({
        data: {
          assetId: thumbnailAsset.id,
          version: 1,
          bucket: thumbnailUploadResult.bucket,
          objectKey: thumbnailUploadResult.key,
          mimeType: 'image/jpeg',
          originalName: `${jobId}.jpg`,
          sizeBytes: thumbnailBuffer.length,
          metadata: {
            sourceJobId: job.id,
            sourceInputAssetId: inputAsset.id,
            provider: 'modal',
            kind: 'video-thumbnail',
          },
        },
      });

      await this.ensureJobNotCancelled(jobId, 'Job cancelled before completion');
      await setStatus(JobStatus.COMPLETED, 100, {
        completedAt: new Date(),
      });

      return {
        outputAssetId: outputAsset.id,
        bucket: uploadResult.bucket,
        objectKey: uploadResult.key,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      await Promise.allSettled(
        uploadedKeys.map((key) => this.storageService.delete(key)),
      );

      if (err instanceof JobCancelledError) {
        await this.cleanupOutputArtifacts(jobId);
        await this.log(jobId, message);
        return;
      }

      const maxAttempts = bullJob.opts.attempts ?? 1;
      const isFinalAttempt = bullJob.attemptsMade + 1 >= maxAttempts;

      if (!isFinalAttempt) {
        await setStatus(JobStatus.QUEUED, Math.max(currentProgress, 1), {
          errorMessage: message,
        });
        await this.log(
          jobId,
          `Attempt ${bullJob.attemptsMade + 1} failed, retrying: ${message}`,
        );
        throw err;
      }

      await this.cleanupOutputArtifacts(jobId);
      await setStatus(JobStatus.FAILED, Math.max(currentProgress, 1), {
        errorMessage: message,
        failedAt: new Date(),
      });

      await this.refundFailedJob(job, message);
      await this.log(jobId, `Job failed permanently: ${message}`);
      throw err;
    }
  }

  private extractInputAssetId(extraConfig: Prisma.JsonValue | null): string | null {
    return this.extractExtraConfigString(extraConfig, 'inputAssetId');
  }

  private extractExtraConfigString(
    extraConfig: Prisma.JsonValue | null,
    key: string,
  ): string | null {
    if (!extraConfig || typeof extraConfig !== 'object' || Array.isArray(extraConfig)) {
      return null;
    }

    const value = (extraConfig as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  private async resolveInputAsset(job: {
    id: string;
    extraConfig: Prisma.JsonValue | null;
  }) {
    const inputAssetId = this.extractInputAssetId(job.extraConfig);
    if (inputAssetId) {
      const asset = await this.prisma.asset.findUnique({
        where: { id: inputAssetId },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });

      if (asset) {
        return asset;
      }
    }

    return this.prisma.asset.findFirst({
      where: {
        jobId: job.id,
        type: AssetType.IMAGE,
        role: AssetRole.INPUT,
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
  }

  private async ensureJobNotCancelled(jobId: string, message: string) {
    const latestJob = await this.prisma.generateJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (latestJob?.status === JobStatus.CANCELLED) {
      throw new JobCancelledError(message);
    }
  }

  private async cleanupOutputArtifacts(jobId: string) {
    const outputAssets = await this.prisma.asset.findMany({
      where: {
        jobId,
        role: {
          in: [AssetRole.OUTPUT, AssetRole.THUMBNAIL],
        },
      },
      include: {
        versions: true,
      },
    });

    await Promise.allSettled(
      outputAssets.flatMap((asset) =>
        asset.versions.map((version) =>
          this.storageService.delete(version.objectKey),
        ),
      ),
    );

    if (outputAssets.length > 0) {
      await this.prisma.asset.deleteMany({
        where: {
          id: {
            in: outputAssets.map((asset) => asset.id),
          },
        },
      });
    }
  }

  private async refundFailedJob(
    job: { id: string; userId: string; creditCost: number },
    message: string,
  ) {
    if (job.creditCost <= 0) {
      return;
    }

    const existingRefund = await this.prisma.creditTransaction.findFirst({
      where: {
        userId: job.userId,
        reason: CreditReason.REFUND_FAILED_JOB,
        metadata: {
          path: ['jobId'],
          equals: job.id,
        },
      },
    });

    if (existingRefund) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
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
          reason: CreditReason.REFUND_FAILED_JOB,
          metadata: {
            jobId: job.id,
            failedMessage: message,
          },
        },
      });
    });
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
