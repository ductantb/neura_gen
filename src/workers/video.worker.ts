import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  AssetRole,
  AssetType,
  CreditReason,
  JobStatus,
} from '@prisma/client';
import { StorageService } from 'src/infra/storage/storage.service';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { ModalService } from 'src/modules/modal/modal.service';
import { generateThumbnailFromVideoBuffer } from 'src/utils/video-thumbnail.util';

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
  async start(redis: Redis) {
    if (process.env.RUN_WORKER !== 'true') return;

    const queueName = process.env.VIDEO_QUEUE_NAME || 'video-gen';
    const concurrency = Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 2);

    this.worker = new Worker(
      queueName,
      async (bullJob: Job) => this.handle(bullJob),
      { connection: redis, concurrency },
    );

    this.worker.on('completed', () => {});
    this.worker.on('failed', () => {});
  }

  // main job handler
  private async handle(bullJob: Job) {
    // extract jobId from queue data
    const { jobId } = bullJob.data as { jobId: string };

    // fetch job from database
    const job = await this.prisma.generateJob.findUnique({
      where: { id: jobId },
      include: { assets: true },
    });

    if (!job) return;

    // skip if job was canceled
    if (job.status === JobStatus.CANCELLED) return;

    try {
      // mark job as processing
      await this.setStatus(jobId, JobStatus.PROCESSING, 5, {
        startedAt: new Date(),
        errorMessage: null,
      });

      // find input image asset
      const inputAsset = await this.prisma.asset.findFirst({
        where: {
          jobId,
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

      if (!inputAsset) throw new Error();

      // get latest version of input asset
      const inputVersion = inputAsset.versions[0];
      if (!inputVersion) throw new Error();

      await this.setStatus(jobId, JobStatus.PROCESSING, 15);

      // generate signed url for input image
      const signedInputUrl = await this.storageService.getDownloadSignedUrl(
        inputVersion.objectKey,
        60 * 60,
      );

      await this.setStatus(jobId, JobStatus.PROCESSING, 30);

      // reload job tránh race condition
      const latestJob = await this.prisma.generateJob.findUnique({
        where: { id: jobId },
      });

      if (latestJob?.status === JobStatus.CANCELLED) {
        await this.log(jobId, 'Job cancelled before processing modal');
        return;
      }

      // call modal api to generate video
      const modalResponse = await this.modal.generateVideo({
        prompt: job.prompt,
        negativePrompt: job.negativePrompt ?? undefined,
        inputImageUrl: signedInputUrl.url,
        modelName: job.modelName ?? undefined,
        userId: job.userId,
      });

      await this.setStatus(jobId, JobStatus.PROCESSING, 60);

      // extract video buffer from response
      const videoBuffer = await this.modal.getVideoBuffer(modalResponse);

      await this.setStatus(jobId, JobStatus.PROCESSING, 80);

      // upload video to storage
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

      await this.setStatus(jobId, JobStatus.PROCESSING, 90);

      // create output video asset
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

      await this.setStatus(jobId, JobStatus.PROCESSING, 95);

      // create asset version for video
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

      // generate thumbnail from video
      const thumbnailBuffer = await generateThumbnailFromVideoBuffer(videoBuffer);

      // upload thumbnail
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

      // create thumbnail asset
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

      // create asset version for thumbnail
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

      // mark job as completed
      await this.setStatus(jobId, JobStatus.COMPLETED, 100, {
        completedAt: new Date(),
      });

      return {
        outputAssetId: outputAsset.id,
        bucket: uploadResult.bucket,
        objectKey: uploadResult.key,
      };

    } catch (err) {
      // mark job as failed
      const message = err instanceof Error ? err.message : 'Unknown error';

      await this.setStatus(jobId, JobStatus.FAILED, 100, {
        errorMessage: message,
        failedAt: new Date(),
      });

      // refund credits if needed
      if (job.creditCost > 0) {
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

        if (!existingRefund) {
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
      }

      throw err;
    }
  }

  // close worker on module destroy
  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
  }
}