import { Injectable, OnModuleDestroy } from '@nestjs/common';
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

@Injectable()
export class VideoWorker implements OnModuleDestroy {
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modal: ModalService,
    private readonly storageService: StorageService,
    private readonly assetsService: AssetsService,
  ) {}

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private async log(jobId: string, message: string) {
    await this.prisma.jobLog.create({ data: { jobId, message } });
  }

  private async setStatus(jobId: string, status: JobStatus, progress: number) {
    await this.prisma.generateJob.update({
      where: { id: jobId },
      data: { status, progress },
    });
  }

  async start(redis: Redis) {
    // Chỉ chạy worker trong container worker
    if (process.env.RUN_WORKER !== 'true') return;

    const queueName = process.env.VIDEO_QUEUE_NAME || 'video-gen';
    const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);

    this.worker = new Worker(
      queueName,
      async (bullJob: Job) => this.handle(bullJob),
      { connection: redis, concurrency },
    );

    // Optional logs
    this.worker.on('completed', (job) => {
      // eslint-disable-next-line no-console
      console.log(` Completed job ${job.id}`);
    });
    this.worker.on('failed', (job, err) => {
      // eslint-disable-next-line no-console
      console.error(` Failed job ${job?.id}`, err);
    });
  }

  private async handle(bullJob: Job) {
    const { jobId } = bullJob.data as { jobId: string };

    const job = await this.prisma.generateJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;

    await this.log(jobId, 'Worker started');
    await this.setStatus(jobId, JobStatus.PROCESSING, 5);

    // Call Modal (gom vào ModalService)
    await this.log(jobId, 'Calling Modal...');
    const modalRes = await this.modal.generateVideo({ prompt: job.prompt });

    await this.setStatus(jobId, JobStatus.PROCESSING, 60);

    // Get video buffer (base64 hoặc url)
    const buffer = await this.modal.getVideoBuffer(modalRes);

    await this.setStatus(jobId, JobStatus.PROCESSING, 80);

    // Save file (tạm local; sau này thay S3 ở đây)
    const dir = process.env.ASSET_STORAGE_DIR || 'public/generated';
    this.ensureDir(dir);

    const fileName = `${jobId}-${crypto.randomBytes(5).toString('hex')}.mp4`;
    const filePath = path.join(dir, fileName);
    const uploaded = await this.storageService.upload({
      buffer,
      mimeType: 'video/mp4',
      originalName: `${job.prompt}.mp4`,
      folder: `jobs/${jobId}/output`,
    })

    const baseUrl =
      process.env.PUBLIC_ASSET_BASE_URL || 'http://localhost:3000/public';
    const fileUrl = `${baseUrl}/generated/${fileName}`;

    await this.log(jobId, `Video saved: ${fileUrl}`);

    // Asset + Version
    const asset = await this.prisma.asset.create({
      data: {
        userId: job.userId,
        jobId,
        type: AssetType.VIDEO,
        role: AssetRole.OUTPUT,
      },

    });

    await this.prisma.assetVersion.create({
      data: {
        assetId: asset.id,
        version: 1,
        bucket: 'local',
        objectKey: filePath,
        mimeType: 'video/mp4',
        sizeBytes: buffer.length,
        metadata: {
          prompt: job.prompt,
          modelName: job.modelName,
        },
      },
    });

    await this.setStatus(jobId, JobStatus.COMPLETED, 100);
    await this.log(jobId, 'Job completed successfully');

    return { fileUrl };
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}