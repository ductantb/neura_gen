import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus, JobType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Queue } from 'bullmq';
import { VIDEO_QUEUE } from 'src/common/constants';

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
      {
        jobId: job.id, 
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
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
