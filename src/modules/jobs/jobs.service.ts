import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AssetRole,
  CreditReason,
  JobStatus,
  JobType,
  Prisma,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { VIDEO_QUEUE } from 'src/common/constants';
import { StorageService } from 'src/infra/storage/storage.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JobEventsService, type JobSnapshotPayload } from './job-events.service';
import { CreateVideoJobDto } from './dto/create-job.dto';
import {
  resolveVideoPreset,
  VIDEO_GENERATION_PRESETS,
  type VideoGenerationPresetId,
  type VideoGenerationWorkflow,
} from './video-generation.catalog';

type AssetWithLatestVersion = {
  id: string;
  userId: string;
  role: AssetRole;
  versions: Array<{
    bucket: string;
    objectKey: string;
    mimeType: string | null;
    sizeBytes: number | null;
    createdAt: Date;
  }>;
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly jobEvents: JobEventsService,
    @Inject(VIDEO_QUEUE) private readonly videoQueue: Queue,
  ) {}

  async createVideoJob(userId: string, dto: CreateVideoJobDto) {
    const preset = resolveVideoPreset(dto.presetId);
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

    const createdJob = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.userCredit.findUnique({
        where: { userId },
      });

      if (!wallet) {
        throw new NotFoundException('User credit wallet not found');
      }

      if (wallet.balance < preset.creditCost) {
        throw new BadRequestException('Not enough credit');
      }

      await tx.userCredit.update({
        where: { userId },
        data: {
          balance: {
            decrement: preset.creditCost,
          },
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          amount: -preset.creditCost,
          reason: CreditReason.CREATE_IMAGE_TO_VIDEO_JOB,
          metadata: {
            inputAssetId: dto.inputAssetId,
            prompt: dto.prompt,
            presetId: preset.id,
          },
        },
      });

      return tx.generateJob.create({
        data: {
          userId,
          type: JobType.IMAGE_TO_VIDEO,
          status: JobStatus.PENDING,
          prompt: dto.prompt,
          negativePrompt: dto.negativePrompt,
          modelName: preset.modelName,
          turboEnabled: preset.turboEnabled,
          progress: 0,
          creditCost: preset.creditCost,
          provider: preset.provider,
          extraConfig: {
            inputAssetId: dto.inputAssetId,
            presetId: preset.id,
            workflow: preset.workflow,
          },
          logs: {
            create: [
              { message: 'Job created' },
              { message: `Input asset: ${inputAsset.id}` },
              { message: `Credit charged: ${preset.creditCost}` },
              { message: `Preset selected: ${preset.id}` },
              { message: `Tier selected: ${preset.tier}` },
              {
                message: `Estimated runtime: ${preset.estimatedDurationSeconds}s`,
              },
            ],
          },
        },
      });
    });

    try {
      await this.videoQueue.add(
        'generate-video',
        { jobId: createdJob.id },
        {
          jobId: createdJob.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown queue error';

      let failedStatusPayload:
        | {
            jobId: string;
            status: JobStatus;
            progress: number;
            errorMessage: string | null;
            startedAt: string | null;
            completedAt: string | null;
            failedAt: string | null;
            occurredAt: string;
          }
        | null = null;
      let failedLogPayload: { jobId: string; message: string; createdAt: string } | null =
        null;

      await this.prisma.$transaction(async (tx) => {
        const failedJob = await tx.generateJob.update({
          where: { id: createdJob.id },
          data: {
            status: JobStatus.FAILED,
            errorMessage: `Queue enqueue failed: ${message}`,
            failedAt: new Date(),
          },
        });

        failedStatusPayload = this.buildStatusPayload(failedJob);

        await this.refundCreditIfMissing(
          tx,
          createdJob,
          CreditReason.REFUND_FAILED_JOB,
          {
            jobId: createdJob.id,
            failedMessage: `Queue enqueue failed: ${message}`,
          },
        );

        const logEntry = await tx.jobLog.create({
          data: {
            jobId: createdJob.id,
            message: `Queue enqueue failed: ${message}`,
          },
        });

        failedLogPayload = this.buildLogPayload(logEntry);
      });

      if (failedStatusPayload) {
        this.jobEvents.emitStatus(failedStatusPayload);
      }

      if (failedLogPayload) {
        this.jobEvents.emitLog(failedLogPayload);
      }

      throw new ServiceUnavailableException(
        'Failed to queue video job. Credits were refunded.',
      );
    }

    let queuedStatusPayload:
      | {
          jobId: string;
          status: JobStatus;
          progress: number;
          errorMessage: string | null;
          startedAt: string | null;
          completedAt: string | null;
          failedAt: string | null;
          occurredAt: string;
        }
      | null = null;
    let queuedLogPayload: { jobId: string; message: string; createdAt: string } | null =
      null;

    await this.prisma.$transaction(async (tx) => {
      const queuedJob = await tx.generateJob.update({
        where: { id: createdJob.id },
        data: {
          status: JobStatus.QUEUED,
          progress: 1,
        },
      });

      queuedStatusPayload = this.buildStatusPayload(queuedJob);

      const logEntry = await tx.jobLog.create({
        data: {
          jobId: createdJob.id,
          message: 'Job queued',
        },
      });

      queuedLogPayload = this.buildLogPayload(logEntry);
    });

    if (queuedStatusPayload) {
      this.jobEvents.emitStatus(queuedStatusPayload);
    }

    if (queuedLogPayload) {
      this.jobEvents.emitLog(queuedLogPayload);
    }

    return {
      jobId: createdJob.id,
      status: JobStatus.QUEUED,
      creditCost: createdJob.creditCost,
      provider: createdJob.provider,
      modelName: createdJob.modelName,
      presetId: preset.id,
      tier: preset.tier,
      turboEnabled: preset.turboEnabled,
      estimatedDurationSeconds: preset.estimatedDurationSeconds,
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

        const thumbnailAsset = job.assets.find(
          (a) => a.role === AssetRole.THUMBNAIL,
        );
        const latestThumbnailVersion = thumbnailAsset?.versions?.[0];

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
          provider: job.provider,
          modelName: job.modelName,
          presetId: this.extractPresetId(job.extraConfig),
          tier: this.extractPresetMetadata(job.extraConfig)?.tier ?? null,
          estimatedDurationSeconds:
            this.extractPresetMetadata(job.extraConfig)?.estimatedDurationSeconds ?? null,
          workflow: this.extractWorkflow(job.extraConfig),
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

    const inputAssets = await this.resolveInputAssets(job);
    const outputAssets = job.assets.filter((a) => a.role === AssetRole.OUTPUT);
    const thumbnailAssets = job.assets.filter(
      (a) => a.role === AssetRole.THUMBNAIL,
    );

    const output = await this.buildOutputResult(outputAssets[0]);
    const thumbnail = await this.buildOutputResult(thumbnailAssets[0]);

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      provider: job.provider,
      modelName: job.modelName,
      presetId: this.extractPresetId(job.extraConfig),
      tier: this.extractPresetMetadata(job.extraConfig)?.tier ?? null,
      estimatedDurationSeconds:
        this.extractPresetMetadata(job.extraConfig)?.estimatedDurationSeconds ?? null,
      workflow: this.extractWorkflow(job.extraConfig),
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

    const thumbnailAsset = job.assets.find(
      (a) => a.role === AssetRole.THUMBNAIL,
    );
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
      provider: job.provider,
      modelName: job.modelName,
      presetId: this.extractPresetId(job.extraConfig),
      tier: this.extractPresetMetadata(job.extraConfig)?.tier ?? null,
      estimatedDurationSeconds:
        this.extractPresetMetadata(job.extraConfig)?.estimatedDurationSeconds ?? null,
      workflow: this.extractWorkflow(job.extraConfig),
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

  async getJobStreamSnapshot(
    userId: string,
    id: string,
  ): Promise<JobSnapshotPayload> {
    const job = await this.prisma.generateJob.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        logs: {
          orderBy: { createdAt: 'asc' },
          take: 50,
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return this.buildSnapshotPayload(job);
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

    const bullJob = await this.videoQueue.getJob(job.id);
    if (bullJob) {
      try {
        await bullJob.remove();
      } catch {
        const logEntry = await this.prisma.jobLog.create({
          data: {
            jobId: job.id,
            message:
              'Job marked as cancelled while an active worker was still running',
          },
        });

        this.jobEvents.emitLog(this.buildLogPayload(logEntry));
      }
    }

    let cancelledStatusPayload:
      | {
          jobId: string;
          status: JobStatus;
          progress: number;
          errorMessage: string | null;
          startedAt: string | null;
          completedAt: string | null;
          failedAt: string | null;
          occurredAt: string;
        }
      | null = null;
    let cancelledLogPayload:
      | {
          jobId: string;
          message: string;
          createdAt: string;
        }
      | null = null;

    await this.prisma.$transaction(async (tx) => {
      const cancelledJob = await tx.generateJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.CANCELLED,
          errorMessage: 'Cancelled by user',
          failedAt: new Date(),
        },
      });

      cancelledStatusPayload = this.buildStatusPayload(cancelledJob);

      await this.refundCreditIfMissing(
        tx,
        job,
        CreditReason.REFUND_CANCELED_JOB,
        { jobId: job.id },
      );

      const logEntry = await tx.jobLog.create({
        data: {
          jobId: job.id,
          message: 'Job canceled by user',
        },
      });

      cancelledLogPayload = this.buildLogPayload(logEntry);
    });

    if (cancelledStatusPayload) {
      this.jobEvents.emitStatus(cancelledStatusPayload);
    }

    if (cancelledLogPayload) {
      this.jobEvents.emitLog(cancelledLogPayload);
    }

    return {
      jobId: job.id,
      status: JobStatus.CANCELLED,
      refundedCredit: job.creditCost,
    };
  }

  private buildSnapshotPayload(job: {
    id: string;
    status: JobStatus;
    progress: number;
    errorMessage: string | null;
    provider: string | null;
    modelName: string | null;
    extraConfig: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    logs: Array<{
      jobId: string;
      message: string;
      createdAt: Date;
    }>;
  }): JobSnapshotPayload {
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage,
      provider: job.provider,
      modelName: job.modelName,
      presetId: this.extractPresetId(job.extraConfig),
      tier: this.extractPresetMetadata(job.extraConfig)?.tier ?? null,
      estimatedDurationSeconds:
        this.extractPresetMetadata(job.extraConfig)?.estimatedDurationSeconds ?? null,
      workflow: this.extractWorkflow(job.extraConfig),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      failedAt: job.failedAt?.toISOString() ?? null,
      logs: job.logs.map((log) => this.buildLogPayload(log)),
    };
  }

  private buildStatusPayload(job: {
    id: string;
    status: JobStatus;
    progress: number;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    updatedAt: Date;
  }) {
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      failedAt: job.failedAt?.toISOString() ?? null,
      occurredAt: job.updatedAt.toISOString(),
    };
  }

  private buildLogPayload(log: { jobId: string; message: string; createdAt: Date }) {
    return {
      jobId: log.jobId,
      message: log.message,
      createdAt: log.createdAt.toISOString(),
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

  private extractInputAssetId(extraConfig: Prisma.JsonValue | null): string | null {
    if (!extraConfig || typeof extraConfig !== 'object' || Array.isArray(extraConfig)) {
      return null;
    }

    const maybeAssetId = (extraConfig as Record<string, unknown>).inputAssetId;
    return typeof maybeAssetId === 'string' ? maybeAssetId : null;
  }

  private extractPresetId(
    extraConfig: Prisma.JsonValue | null,
  ): VideoGenerationPresetId | null {
    if (!extraConfig || typeof extraConfig !== 'object' || Array.isArray(extraConfig)) {
      return null;
    }

    const maybePresetId = (extraConfig as Record<string, unknown>).presetId;
    return typeof maybePresetId === 'string'
      ? (maybePresetId as VideoGenerationPresetId)
      : null;
  }

  private extractWorkflow(
    extraConfig: Prisma.JsonValue | null,
  ): VideoGenerationWorkflow | null {
    if (!extraConfig || typeof extraConfig !== 'object' || Array.isArray(extraConfig)) {
      return null;
    }

    const maybeWorkflow = (extraConfig as Record<string, unknown>).workflow;
    return typeof maybeWorkflow === 'string'
      ? (maybeWorkflow as VideoGenerationWorkflow)
      : null;
  }

  private extractPresetMetadata(extraConfig: Prisma.JsonValue | null) {
    const presetId = this.extractPresetId(extraConfig);
    return presetId ? VIDEO_GENERATION_PRESETS[presetId] ?? null : null;
  }

  private async resolveInputAssets(job: {
    id: string;
    userId: string;
    extraConfig: Prisma.JsonValue | null;
    assets: AssetWithLatestVersion[];
  }): Promise<AssetWithLatestVersion[]> {
    const inputAssetId = this.extractInputAssetId(job.extraConfig);
    if (inputAssetId) {
      const inputAsset = await this.prisma.asset.findUnique({
        where: { id: inputAssetId },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });

      if (inputAsset && inputAsset.userId === job.userId) {
        return [inputAsset];
      }
    }

    return job.assets.filter((asset) => asset.role === AssetRole.INPUT);
  }

  private async refundCreditIfMissing(
    tx: Prisma.TransactionClient,
    job: { id: string; userId: string; creditCost: number },
    reason: CreditReason,
    metadata: Prisma.InputJsonValue,
  ) {
    if (job.creditCost <= 0) {
      return;
    }

    const existingRefund = await tx.creditTransaction.findFirst({
      where: {
        userId: job.userId,
        reason,
        metadata: {
          path: ['jobId'],
          equals: job.id,
        },
      },
    });

    if (existingRefund) {
      return;
    }

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
        reason,
        metadata,
      },
    });
  }
}
