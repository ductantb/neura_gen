import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { JobStatus, AssetType } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { PrismaService } from 'src/infra/prisma/prisma.service';
import { ModalService } from 'src/modules/modal/modal.service';

@Injectable()
export class VideoWorker implements OnModuleDestroy {
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modal: ModalService,
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
      console.log(`✅ Completed job ${job.id}`);
    });
    this.worker.on('failed', (job, err) => {
      // eslint-disable-next-line no-console
      console.error(`❌ Failed job ${job?.id}`, err);
    });
  }

  private async handle(bullJob: Job) {
    const { jobId } = bullJob.data as { jobId: string };

    const job = await this.prisma.generateJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;

    await this.log(jobId, 'Worker started');
    await this.setStatus(jobId, JobStatus.RUNNING, 5);

    // Call Modal (gom vào ModalService)
    await this.log(jobId, 'Calling Modal...');
    const modalRes = await this.modal.generateVideo({ prompt: job.prompt });

    await this.setStatus(jobId, JobStatus.RUNNING, 60);

    // Get video buffer (base64 hoặc url)
    const buffer = await this.modal.getVideoBuffer(modalRes);

    await this.setStatus(jobId, JobStatus.RUNNING, 80);

    // Save file (tạm local; sau này thay S3 ở đây)
    const dir = process.env.ASSET_STORAGE_DIR || 'public/generated';
    this.ensureDir(dir);

    const fileName = `${jobId}-${crypto.randomBytes(5).toString('hex')}.mp4`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buffer);

    const baseUrl =
      process.env.PUBLIC_ASSET_BASE_URL || 'http://localhost:3000/public';
    const fileUrl = `${baseUrl}/generated/${fileName}`;

    await this.log(jobId, `Video saved: ${fileUrl}`);

    // Asset + Version
    const asset = await this.prisma.asset.create({
      data: { jobId, type: AssetType.VIDEO },
    });

    await this.prisma.assetVersion.create({
      data: {
        assetId: asset.id,
        version: 1,
        fileUrl,
        metadata: {
          prompt: job.prompt,
          modelName: job.modelName,
        },
      },
    });

    await this.setStatus(jobId, JobStatus.DONE, 100);
    await this.log(jobId, 'Job DONE');

    return { fileUrl };
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}