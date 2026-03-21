import { Injectable, OnModuleDestroy, NotFoundException } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { JobStatus, AssetType, AssetRole } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StorageService } from 'src/infra/storage/storage.service';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { ModalService } from 'src/modules/modal/modal.service';
import { AssetsService } from 'src/modules/assets/assets.service';
import { use } from 'passport';
import { buffer } from 'stream/consumers';

@Injectable()
export class VideoWorker implements OnModuleDestroy {
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modal: ModalService,
    private readonly storageService: StorageService,
    //private readonly assetsService: AssetsService,
  ) {}



  //log job
  private async log(jobId: string, message: string) {
    await this.prisma.jobLog.create({
      data: {
        jobId,
        message,
      },
    });
  }

  //set status of job
  private async setStatus(
    jobId: string,
    status: JobStatus,
    progress: number,
    extra?: Partial<{
      errorMessage: string | null;
      startedAt: Date;
      completedAt: Date;
      failedAt: Date;
    }>
  ) {
    await this.prisma.generateJob.update({
      where: { id: jobId },
      data: { status,
        progress,
        ...(extra ? extra : {})
       },
    });
  }

  //start worker
  async start(redis: Redis) {
    if(process.env.RUN_WORKER !== 'true') {
      console.log("Worker not started because RUN_WORKER is not set to 'true'");
      return;
    }

    const queueName = process.env.VIDEO_QUEUE_NAME || 'video-gen';
    const concurrency = Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 2);

    this.worker = new Worker(queueName, async (bullJob: Job) => this.handle(bullJob), 
      { connection: redis, concurrency },);

    this.worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err);
    });
  }

  private async handle(bullJob: Job) {
    const { jobId } = bullJob.data as { jobId: string };
    
    const job = await this.prisma.generateJob.findUnique({ where: { id: jobId }, include: { assets: true } });
    if (!job) {
      console.error(`Job ${jobId} not found in database`);
      return;
    }

    try {
      await this.log(jobId, 'Worker started processing job');
      await this.setStatus(jobId, JobStatus.PROCESSING, 5, 
        { startedAt: new Date(),
          errorMessage: null,
         });

      // get input asset
    const inputAsset = await this.prisma.asset.findFirst({ 
      where: { 
        jobId,
        type: AssetType.IMAGE,
        role: AssetRole.INPUT,
      },
      include: { versions: {
        orderBy: { version: 'desc' },
        take: 1,
      } },
    });

    if (!inputAsset) {
      throw new Error(`Input asset not found for job ${jobId}`);
    }

    const inputVersion = inputAsset.versions[0];
    if (!inputVersion) {
      throw new Error(`No versions found for input asset ${inputAsset.id}`);
    }

    await this.log(jobId, `Found input asset ${inputAsset.id} version ${inputVersion.id}`);
    await this.setStatus(jobId, JobStatus.PROCESSING, 15);

    // create url for input in S3 private
    const signedInputUrl = await this.storageService.getDownloadSignedUrl(inputVersion.objectKey, 60 * 60); 

      await this.log(jobId, `Generated signed URL for input asset: ${signedInputUrl.url}`);
      await this.setStatus(jobId, JobStatus.PROCESSING, 30);

    // call modal to generate video (image + prompt => video)
    await this.log(jobId, `Calling Modal API to generate video from image and prompt`);

    const modalResponse = await this.modal.generateVideo({
      prompt: job.prompt,
      negativePrompt: job.negativePrompt ?? undefined,
      inputImageUrl: signedInputUrl.url,
      modelName: job.modelName ?? undefined,
      userId: job.userId,
    });

    await this.log(jobId, `Received response from Modal API`);
    await this.setStatus(jobId, JobStatus.PROCESSING, 60);

    // get video buffer from modal response
    let videoBuffer: Buffer;
    try {
      videoBuffer = await this.modal.getVideoBuffer(modalResponse);
      console.log(`[Job ${jobId}] Retrieved video buffer from Modal response, size: ${videoBuffer.length} bytes`);
      await this.log(jobId, `Retrieved video buffer from Modal response, size: ${videoBuffer.length} bytes`);
    } catch (bufferError) {
      const errorMsg = `Failed to extract video buffer from Modal response: ${bufferError instanceof Error ? bufferError.message : String(bufferError)}`;
      console.error(`[Job ${jobId}] ${errorMsg}`);
      await this.log(jobId, errorMsg);
      throw bufferError;
    }
    await this.setStatus(jobId, JobStatus.PROCESSING, 80);

    // upload video buffer to S3
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

    await this.log(jobId, `Uploaded generated video to storage with key: ${uploadResult.key}`);
    await this.setStatus(jobId, JobStatus.PROCESSING, 90);

    // create output asset
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

    await this.log(jobId, `Created output asset: ${outputAsset.id}`);
    await this.setStatus(jobId, JobStatus.PROCESSING, 95);
    
    // create asset version for output asset
    await this.prisma.assetVersion.create({
      data: {
        assetId: outputAsset.id,
        version: 1,
        // storageProvider: 'S3',
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

    await this.log(jobId, `Created output asset version for ${outputAsset.id}`);

    // complete job
    await this.setStatus(jobId, JobStatus.COMPLETED, 100, { completedAt: new Date() });
    await this.log(jobId, `Job completed successfully`);
    return {
      outputAssetId: outputAsset.id,
      bucket: uploadResult.bucket,
      objectKey: uploadResult.key,
    };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await this.setStatus(jobId, JobStatus.FAILED, 100, { errorMessage: message, failedAt: new Date() });
      await this.log(jobId, `Job failed with error: ${message}`);
      throw err;
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
  }
}