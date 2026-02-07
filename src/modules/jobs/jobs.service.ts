import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus, JobType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { Queue } from 'bullmq';
import { VIDEO_QUEUE } from './jobs.module';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(VIDEO_QUEUE) private readonly videoQueue: Queue,
  ) {}

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

    await this.videoQueue.add(
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
