import { Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus, JobType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
const videoQueue = new Queue('video-gen', { connection });

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async createVideoJob(userId: string, prompt: string) {
    const job = await this.prisma.generateJob.create({
      data: {
        userId,
        type: JobType.IMAGE_TO_VIDEO,
        prompt,
        modelName: 'modal:neura-video-gen/generate_video',
        turboEnabled: false,
        status: JobStatus.PENDING,
        progress: 0,
      },
    });

    await this.prisma.jobLog.create({
      data: {
        jobId: job.id,
        message: 'Job created',
      },
    });

    await videoQueue.add(
      'generate',
      { jobId: job.id },
      { attempts: 2 },
    );

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
    };
  }

  async getJobWithAssets(id: string) {
    const job = await this.prisma.generateJob.findUnique({
      where: { id },
      include: {
        assets: {
          include: { versions: true },
        },
        logs: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}
