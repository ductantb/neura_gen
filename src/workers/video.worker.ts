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
import { JobEventsService } from 'src/modules/jobs/job-events.service';
import { ModalService } from 'src/modules/modal/modal.service';
import { generateThumbnailFromVideoBuffer } from 'src/utils/video-thumbnail.util';

// Custom error to distinguish cancellation from normal errors
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
    private readonly jobEvents: JobEventsService,
  ) {}

  // create job log
  // Purpose: Save a log message related to a job into DB
  private async log(jobId: string, message: string) {
    const logEntry = await this.prisma.jobLog.create({
      data: { jobId, message },
    });

    this.jobEvents.emitLog({
      jobId,
      message,
      createdAt: logEntry.createdAt.toISOString(),
    });
  }

  // update job status and progress
  // Purpose: Update job state (PROCESSING, COMPLETED, FAILED, etc.)
  // and track progress percentage
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
    const updatedJob = await this.prisma.generateJob.update({
      where: { id: jobId },
      data: {
        status,
        progress,
        // Spread extra fields if provided (timestamps, error message)
        ...(extra ? extra : {}),
      },
    });

    this.jobEvents.emitStatus({
      jobId: updatedJob.id,
      status: updatedJob.status,
      progress: updatedJob.progress,
      errorMessage: updatedJob.errorMessage,
      startedAt: updatedJob.startedAt?.toISOString() ?? null,
      completedAt: updatedJob.completedAt?.toISOString() ?? null,
      failedAt: updatedJob.failedAt?.toISOString() ?? null,
      occurredAt: updatedJob.updatedAt.toISOString(),
    });
  }

  // initialize worker and listen to queue
  // Purpose: Start BullMQ worker to consume jobs from Redis queue
  async start(redis: Redis): Promise<boolean> {
    // Allow turning off worker via environment variable
    if (process.env.RUN_WORKER !== 'true') {
      return false;
    }

    // Queue name (default: video-gen)
    const queueName = process.env.VIDEO_QUEUE_NAME || 'video-gen';

    // Number of parallel jobs processed
    const concurrency = Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 2);

    // Create worker
    this.worker = new Worker(
      queueName,
      async (bullJob: Job) => this.handle(bullJob), // main handler
      { connection: redis, concurrency },
    );

    this.worker.on('completed', () => {});
    this.worker.on('failed', () => {});

    return true;
  }

  // ========================= MAIN HANDLER =========================
  private async handle(bullJob: Job) {
    const { jobId } = bullJob.data as { jobId: string };

    const job = await this.prisma.generateJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;
    if (job.status === JobStatus.CANCELLED || job.status === JobStatus.COMPLETED) {
      return;
    }

    // Track uploaded files (for rollback)
    const uploadedKeys: string[] = [];

    // Track progress locally
    let currentProgress = job.progress;

    // Helper function to update status
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
      // Check cancellation before starting
      await this.ensureJobNotCancelled(jobId, 'Job cancelled before processing started');

      // Cleanup old outputs (important for retries)
      await this.cleanupOutputArtifacts(jobId);

      // Mark job as processing
      await setStatus(JobStatus.PROCESSING, 5, {
        startedAt: new Date(),
        errorMessage: null,
      });

      // Resolve input asset (image)
      const inputAsset = await this.resolveInputAsset(job);
      if (!inputAsset) {
        throw new Error('Input asset not found for job');
      }

      // Get latest version of input
      const inputVersion = inputAsset.versions[0];
      if (!inputVersion) {
        throw new Error('Input asset has no versions');
      }

      await setStatus(JobStatus.PROCESSING, 15);

      // Generate signed URL to download input image
      const signedInputUrl = await this.storageService.getDownloadSignedUrl(
        inputVersion.objectKey,
        60 * 60,
      );

      await setStatus(JobStatus.PROCESSING, 30);

      // Check cancellation before calling AI
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

      // Check cancellation after AI response
      await this.ensureJobNotCancelled(jobId, 'Job cancelled after provider response');

      // Convert response to video buffer
      const videoBuffer = await this.modal.getVideoBuffer(modalResponse);

      await setStatus(JobStatus.PROCESSING, 80);

      // Check cancellation before upload
      await this.ensureJobNotCancelled(jobId, 'Job cancelled before uploading outputs');

      // Upload video
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

      // Create video asset record
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

      // Save video version metadata
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

      // Generate thumbnail
      const thumbnailBuffer = await generateThumbnailFromVideoBuffer(videoBuffer);

      // Upload thumbnail
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

      // Create thumbnail asset
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

      // Save thumbnail version metadata
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

      // Mark completed
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

      // Rollback uploaded files
      await Promise.allSettled(
        uploadedKeys.map((key) => this.storageService.delete(key)),
      );

      // Handle cancellation separately
      if (err instanceof JobCancelledError) {
        await this.cleanupOutputArtifacts(jobId);
        await this.log(jobId, message);
        return;
      }

      // Retry logic
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

      // Final failure
      await this.cleanupOutputArtifacts(jobId);

      await setStatus(JobStatus.FAILED, Math.max(currentProgress, 1), {
        errorMessage: message,
        failedAt: new Date(),
      });

      // Refund user
      await this.refundFailedJob(job, message);

      await this.log(jobId, `Job failed permanently: ${message}`);

      throw err;
    }
  }

  // extract inputAssetId
  private extractInputAssetId(extraConfig: Prisma.JsonValue | null): string | null {
    return this.extractExtraConfigString(extraConfig, 'inputAssetId');
  }

  // extract string value from JSON config
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

  // resolve input asset
  private async resolveInputAsset(job: {
    id: string;
    extraConfig: Prisma.JsonValue | null;
  }) {
    const inputAssetId = this.extractInputAssetId(job.extraConfig);

    // Priority 1: assetId from config
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

    // Fallback: find latest IMAGE input asset
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

  // check if job is cancelled
  private async ensureJobNotCancelled(jobId: string, message: string) {
    const latestJob = await this.prisma.generateJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (latestJob?.status === JobStatus.CANCELLED) {
      throw new JobCancelledError(message);
    }
  }

  // cleanup output artifacts
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

    // Delete files from storage
    await Promise.allSettled(
      outputAssets.flatMap((asset) =>
        asset.versions.map((version) =>
          this.storageService.delete(version.objectKey),
        ),
      ),
    );

    // Delete DB records
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

  // refund credits for failed job
  private async refundFailedJob(
    job: { id: string; userId: string; creditCost: number },
    message: string,
  ) {
    // Skip if no cost
    if (job.creditCost <= 0) {
      return;
    }

    // Prevent duplicate refund
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

    // Transaction: update balance + create record
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

  // cleanup worker when app shuts down
  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
