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
import { VastService } from 'src/modules/modal/vast.service';
import { generateThumbnailFromVideoBuffer } from 'src/utils/video-thumbnail.util';
import { addBackgroundAudioToVideoBuffer } from 'src/utils/video-background-audio.util';
import type { ProviderRequestError } from 'src/modules/modal/provider-error.types';

// Custom error to distinguish cancellation from normal errors
class JobCancelledError extends Error {
  constructor(message = 'Job cancelled') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

type VideoProviderName = 'vast' | 'modal';

type ProviderExecutionResult = {
  provider: VideoProviderName;
  response: unknown;
  providerAttempt: number;
  fallbackTriggered: boolean;
};

@Injectable()
export class VideoWorker implements OnModuleDestroy {
  private worker?: Worker;
  private vastBreakerOpenedUntilMs = 0;
  private vastFailureTimestampsMs: number[] = [];
  private vastConsecutiveFailures = 0;
  private vastHalfOpenSuccessCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modal: ModalService,
    private readonly vast: VastService,
    private readonly storageService: StorageService,
    private readonly jobEvents: JobEventsService,
  ) {}

  // create job log
  // Purpose: Save a log message related to a job into DB
  private async log(
    jobId: string,
    message: string,
    extra?: Partial<{
      provider: string | null;
      providerAttempt: number | null;
      fallbackTriggered: boolean;
    }>,
  ) {
    const logEntry = await this.prisma.jobLog.create({
      data: { jobId, message },
    });

    this.jobEvents.emitLog({
      jobId,
      message,
      createdAt: logEntry.createdAt.toISOString(),
      provider: extra?.provider ?? null,
      providerAttempt: extra?.providerAttempt ?? null,
      fallbackTriggered: extra?.fallbackTriggered ?? false,
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
      provider: string | null;
      providerAttempt: number | null;
      fallbackTriggered: boolean;
    }>,
  ) {
    const updateData: Prisma.GenerateJobUpdateInput = {
      status,
      progress,
    };

    if (extra?.errorMessage !== undefined) {
      updateData.errorMessage = extra.errorMessage;
    }
    if (extra?.startedAt !== undefined) {
      updateData.startedAt = extra.startedAt;
    }
    if (extra?.completedAt !== undefined) {
      updateData.completedAt = extra.completedAt;
    }
    if (extra?.failedAt !== undefined) {
      updateData.failedAt = extra.failedAt;
    }
    if (extra?.provider !== undefined) {
      updateData.provider = extra.provider;
    }

    const updatedJob = await this.prisma.generateJob.update({
      where: { id: jobId },
      data: updateData,
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
      provider: extra?.provider ?? updatedJob.provider ?? null,
      providerAttempt: extra?.providerAttempt ?? null,
      fallbackTriggered: extra?.fallbackTriggered ?? false,
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
    if (
      job.status === JobStatus.CANCELLED ||
      job.status === JobStatus.COMPLETED
    ) {
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
        provider: string | null;
        providerAttempt: number | null;
        fallbackTriggered: boolean;
      }>,
    ) => {
      currentProgress = progress;
      await this.setStatus(jobId, status, progress, extra);
    };

    try {
      // Check cancellation before starting
      await this.ensureJobNotCancelled(
        jobId,
        'Job cancelled before processing started',
      );

      // Cleanup old outputs (important for retries)
      await this.cleanupOutputArtifacts(jobId);

      // Mark job as processing
      await setStatus(JobStatus.PROCESSING, 5, {
        startedAt: new Date(),
        errorMessage: null,
      });

      // Resolve optional input asset (image). TI2V jobs can run without it.
      const workflow = this.resolveExecutionWorkflow(job.extraConfig);
      const presetId = this.extractExtraConfigString(
        job.extraConfig,
        'presetId',
      );
      const requiresInputImage = workflow === 'I2V';
      const inputAsset = await this.resolveInputAsset(job);

      await setStatus(JobStatus.PROCESSING, 15);

      let signedInputUrl: string | undefined;
      if (inputAsset) {
        const inputVersion = inputAsset.versions[0];
        if (!inputVersion) {
          throw new Error('Input asset has no versions');
        }

        // Generate signed URL to download input image
        const signed = await this.storageService.getDownloadSignedUrl(
          inputVersion.objectKey,
          60 * 60,
        );
        signedInputUrl = signed.url;
      } else if (requiresInputImage) {
        throw new Error(
          `Input asset is required for workflow ${workflow ?? 'unknown'} (preset: ${presetId ?? 'unknown'})`,
        );
      }

      await setStatus(JobStatus.PROCESSING, 30);

      // Check cancellation before calling AI
      await this.ensureJobNotCancelled(
        jobId,
        'Job cancelled before provider request',
      );

      const providerPlan = this.resolveProviderPlan(
        this.extractProviderPlan(job.extraConfig),
      );
      const providerPayload = {
        prompt: job.prompt,
        negativePrompt: job.negativePrompt ?? undefined,
        inputImageUrl: signedInputUrl,
        jobId: job.id,
        modelName: job.modelName ?? undefined,
        presetId: presetId ?? undefined,
        userId: job.userId,
        workflow: workflow ?? undefined,
      };

      const providerExecution = await this.executeProviderPlan(
        providerPlan,
        providerPayload,
      );

      await this.log(
        jobId,
        `Provider ${providerExecution.provider} succeeded on attempt ${providerExecution.providerAttempt}`,
        {
          provider: providerExecution.provider,
          providerAttempt: providerExecution.providerAttempt,
          fallbackTriggered: providerExecution.fallbackTriggered,
        },
      );

      await setStatus(JobStatus.PROCESSING, 60, {
        provider: providerExecution.provider,
        providerAttempt: providerExecution.providerAttempt,
        fallbackTriggered: providerExecution.fallbackTriggered,
      });

      // Check cancellation after AI response
      await this.ensureJobNotCancelled(
        jobId,
        'Job cancelled after provider response',
      );

      // Convert response to video buffer
      const videoBuffer = await this.getVideoBufferFromProvider(
        providerExecution.provider,
        providerExecution.response,
      );
      let outputVideoBuffer = videoBuffer;
      const shouldAttachBackgroundAudio = this.shouldAttachBackgroundAudio(
        job.extraConfig,
      );

      await setStatus(JobStatus.PROCESSING, 80, {
        provider: providerExecution.provider,
        providerAttempt: providerExecution.providerAttempt,
        fallbackTriggered: providerExecution.fallbackTriggered,
      });

      if (shouldAttachBackgroundAudio) {
        try {
          await this.log(jobId, 'Adding background audio');
          outputVideoBuffer = await addBackgroundAudioToVideoBuffer(
            videoBuffer,
            {
              prompt: job.prompt,
              seed: job.id,
            },
          );
          await this.log(jobId, 'Background audio added');
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown audio merge error';
          await this.log(
            jobId,
            `Background audio skipped due to error: ${message}`,
          );
        }
      }

      // Check cancellation before upload
      await this.ensureJobNotCancelled(
        jobId,
        'Job cancelled before uploading outputs',
      );

      // Upload video
      const uploadResult = await this.storageService.upload({
        buffer: outputVideoBuffer,
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
          sizeBytes: outputVideoBuffer.length,
          metadata: {
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            modelName: job.modelName,
            sourceJobId: job.id,
            ...(inputAsset ? { sourceInputAssetId: inputAsset.id } : {}),
            provider: providerExecution.provider,
            backgroundAudio: shouldAttachBackgroundAudio,
          },
        },
      });

      // Generate thumbnail
      const thumbnailBuffer =
        await generateThumbnailFromVideoBuffer(outputVideoBuffer);

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
            ...(inputAsset ? { sourceInputAssetId: inputAsset.id } : {}),
            provider: providerExecution.provider,
            kind: 'video-thumbnail',
          },
        },
      });

      // Mark completed
      await setStatus(JobStatus.COMPLETED, 100, {
        completedAt: new Date(),
        provider: providerExecution.provider,
        providerAttempt: providerExecution.providerAttempt,
        fallbackTriggered: providerExecution.fallbackTriggered,
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
      const isRetryable = this.isRetryableProviderError(err);
      const isFinalAttempt =
        !isRetryable || bullJob.attemptsMade + 1 >= maxAttempts;

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

      if (!isRetryable) {
        return;
      }

      throw err;
    }
  }

  private isBackgroundAudioEnabledGlobally(): boolean {
    const raw = process.env.VIDEO_BACKGROUND_AUDIO_ENABLED ?? 'true';
    return raw.toLowerCase() !== 'false';
  }

  private async executeProviderPlan(
    providerPlan: VideoProviderName[],
    payload: {
      prompt: string;
      negativePrompt?: string;
      inputImageUrl?: string;
      jobId: string;
      modelName?: string;
      presetId?: string;
      userId?: string;
      workflow?: string;
    },
  ): Promise<ProviderExecutionResult> {
    let lastRetryableError: unknown = null;
    let hasFallback = false;

    for (let providerIndex = 0; providerIndex < providerPlan.length; providerIndex += 1) {
      const provider = providerPlan[providerIndex];
      const hasNextProvider = providerIndex < providerPlan.length - 1;
      if (provider === 'vast' && !(await this.shouldUseVastProvider())) {
        continue;
      }

      const maxRetries = this.resolveProviderMaxRetries(provider);
      for (let retryIndex = 0; retryIndex <= maxRetries; retryIndex += 1) {
        const providerAttempt = retryIndex + 1;
        try {
          await this.log(
            payload.jobId,
            `Calling provider ${provider} (attempt ${providerAttempt}/${maxRetries + 1})`,
            {
              provider,
              providerAttempt,
              fallbackTriggered: hasFallback,
            },
          );

          const response = await this.callProvider(provider, {
            ...payload,
            provider,
          });

          if (provider === 'vast') {
            this.recordVastSuccess();
          }

          return {
            provider,
            response,
            providerAttempt,
            fallbackTriggered: hasFallback,
          };
        } catch (error) {
          const providerError = error as ProviderRequestError;
          const isRetryable = this.isRetryableProviderError(error);

          if (provider === 'vast') {
            this.recordVastFailure(providerError);
          }

          if (!isRetryable) {
            if (!hasNextProvider) {
              throw error;
            }

            hasFallback = true;
            await this.log(
              payload.jobId,
              `Provider ${provider} returned non-retryable error, switching to fallback if available: ${providerError.message}`,
              {
                provider,
                providerAttempt,
                fallbackTriggered: true,
              },
            );
            break;
          }

          if (retryIndex < maxRetries) {
            await this.log(
              payload.jobId,
              `Provider ${provider} attempt ${providerAttempt} failed, retrying: ${providerError.message}`,
              {
                provider,
                providerAttempt,
                fallbackTriggered: hasFallback,
              },
            );
            continue;
          }

          lastRetryableError = error;
          hasFallback = true;
          await this.log(
            payload.jobId,
            `Provider ${provider} exhausted retries, switching to fallback if available: ${providerError.message}`,
            {
              provider,
              providerAttempt,
              fallbackTriggered: true,
            },
          );
          break;
        }
      }
    }

    if (lastRetryableError) {
      throw lastRetryableError;
    }

    throw new Error('No provider is currently available');
  }

  private async callProvider(
    provider: VideoProviderName,
    payload: {
      prompt: string;
      negativePrompt?: string;
      inputImageUrl?: string;
      jobId: string;
      provider: string;
      modelName?: string;
      presetId?: string;
      userId?: string;
      workflow?: string;
    },
  ) {
    if (provider === 'vast') {
      return this.vast.generateVideo(payload);
    }

    return this.modal.generateVideo(payload);
  }

  private async getVideoBufferFromProvider(
    provider: VideoProviderName,
    response: unknown,
  ) {
    if (provider === 'vast') {
      return this.vast.getVideoBuffer(response);
    }

    return this.modal.getVideoBuffer(response);
  }

  private extractProviderPlan(
    extraConfig: Prisma.JsonValue | null,
  ): VideoProviderName[] {
    if (
      !extraConfig ||
      typeof extraConfig !== 'object' ||
      Array.isArray(extraConfig)
    ) {
      return [];
    }

    const raw = (extraConfig as Record<string, unknown>).providerPlan;
    if (!Array.isArray(raw)) {
      return [];
    }

    const filtered = raw.filter(
      (provider): provider is VideoProviderName =>
        provider === 'vast' || provider === 'modal',
    );

    return filtered;
  }

  private resolveProviderPlan(
    jobPlan: VideoProviderName[],
  ): VideoProviderName[] {
    if (jobPlan.length > 0) {
      return [...new Set(jobPlan)];
    }

    const primary = this.resolveProviderName(
      process.env.VIDEO_PROVIDER_PRIMARY,
      'vast',
    );
    const fallback = this.resolveProviderName(
      process.env.VIDEO_PROVIDER_FALLBACK,
      'modal',
    );

    if (primary === fallback) {
      return [primary];
    }

    return [primary, fallback];
  }

  private resolveProviderName(
    raw: string | undefined,
    fallback: VideoProviderName,
  ): VideoProviderName {
    if (raw === 'vast' || raw === 'modal') {
      return raw;
    }

    return fallback;
  }

  private resolveProviderMaxRetries(provider: VideoProviderName) {
    const raw =
      provider === 'vast'
        ? process.env.VAST_MAX_RETRIES
        : process.env.MODAL_MAX_RETRIES;
    const parsed = Number(raw ?? 1);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 1;
    }

    return Math.floor(parsed);
  }

  private async shouldUseVastProvider() {
    if (!this.vast.isEnabled()) {
      return false;
    }

    const now = Date.now();
    if (now < this.vastBreakerOpenedUntilMs) {
      return false;
    }

    const healthy = await this.vast.healthcheck();
    if (!healthy) {
      this.openVastBreaker(now);
      return false;
    }

    return true;
  }

  private recordVastSuccess() {
    if (
      this.vastBreakerOpenedUntilMs > 0 &&
      Date.now() >= this.vastBreakerOpenedUntilMs
    ) {
      this.vastHalfOpenSuccessCount += 1;
      const required = this.resolveVastHalfOpenSuccess();
      if (this.vastHalfOpenSuccessCount >= required) {
        this.resetVastBreaker();
      }
      return;
    }

    this.vastConsecutiveFailures = 0;
  }

  private recordVastFailure(error: ProviderRequestError) {
    const errorType = error.errorType ?? this.inferProviderErrorType(error);
    if (
      errorType !== 'TRANSIENT_INFRA' &&
      errorType !== 'TRANSIENT_TIMEOUT' &&
      errorType !== 'TRANSIENT_OOM'
    ) {
      return;
    }

    const now = Date.now();
    const windowMs = this.resolveVastBreakerWindowMs();
    this.vastFailureTimestampsMs = this.vastFailureTimestampsMs.filter(
      (timestampMs) => now - timestampMs <= windowMs,
    );
    this.vastFailureTimestampsMs.push(now);
    this.vastConsecutiveFailures += 1;

    const threshold = this.resolveVastBreakerFailureThreshold();
    if (this.vastConsecutiveFailures >= threshold) {
      this.openVastBreaker(now);
    }
  }

  private resetVastBreaker() {
    this.vastBreakerOpenedUntilMs = 0;
    this.vastConsecutiveFailures = 0;
    this.vastHalfOpenSuccessCount = 0;
    this.vastFailureTimestampsMs = [];
  }

  private openVastBreaker(nowMs: number) {
    this.vastBreakerOpenedUntilMs = nowMs + this.resolveVastBreakerCooldownMs();
    this.vastConsecutiveFailures = 0;
    this.vastHalfOpenSuccessCount = 0;
  }

  private resolveVastBreakerFailureThreshold() {
    const parsed = Number(process.env.VAST_BREAKER_FAILURE_THRESHOLD ?? 3);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 3;
    }

    return Math.floor(parsed);
  }

  private resolveVastBreakerWindowMs() {
    const parsed = Number(process.env.VAST_BREAKER_WINDOW_SECONDS ?? 300);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 300_000;
    }

    return Math.floor(parsed * 1000);
  }

  private resolveVastBreakerCooldownMs() {
    const parsed = Number(process.env.VAST_BREAKER_COOLDOWN_SECONDS ?? 600);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 600_000;
    }

    return Math.floor(parsed * 1000);
  }

  private resolveVastHalfOpenSuccess() {
    const parsed = Number(process.env.VAST_BREAKER_HALF_OPEN_SUCCESS ?? 3);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 3;
    }

    return Math.floor(parsed);
  }

  private shouldAttachBackgroundAudio(
    extraConfig: Prisma.JsonValue | null,
  ): boolean {
    if (!this.isBackgroundAudioEnabledGlobally()) {
      return false;
    }

    const includeBackgroundAudio = this.extractExtraConfigBoolean(
      extraConfig,
      'includeBackgroundAudio',
    );

    return includeBackgroundAudio ?? true;
  }

  // extract inputAssetId
  private extractInputAssetId(
    extraConfig: Prisma.JsonValue | null,
  ): string | null {
    return this.extractExtraConfigString(extraConfig, 'inputAssetId');
  }

  // extract string value from JSON config
  private extractExtraConfigString(
    extraConfig: Prisma.JsonValue | null,
    key: string,
  ): string | null {
    if (
      !extraConfig ||
      typeof extraConfig !== 'object' ||
      Array.isArray(extraConfig)
    ) {
      return null;
    }

    const value = (extraConfig as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  // extract boolean value from JSON config
  private extractExtraConfigBoolean(
    extraConfig: Prisma.JsonValue | null,
    key: string,
  ): boolean | null {
    if (
      !extraConfig ||
      typeof extraConfig !== 'object' ||
      Array.isArray(extraConfig)
    ) {
      return null;
    }

    const value = (extraConfig as Record<string, unknown>)[key];
    return typeof value === 'boolean' ? value : null;
  }

  private resolveExecutionWorkflow(
    extraConfig: Prisma.JsonValue | null,
  ): string | null {
    const workflow = this.extractExtraConfigString(extraConfig, 'workflow');
    if (workflow) {
      return workflow;
    }

    const inputMode = this.extractExtraConfigString(extraConfig, 'inputMode');
    if (inputMode) {
      return inputMode;
    }

    return this.extractExtraConfigString(extraConfig, 'presetWorkflow');
  }

  private isRetryableProviderError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return true;
    }

    const maybeRetryable = (error as ProviderRequestError).retryable;
    if (typeof maybeRetryable === 'boolean') {
      return maybeRetryable;
    }

    const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof maybeStatusCode !== 'number') {
      return true;
    }

    if (
      maybeStatusCode === 408 ||
      maybeStatusCode === 425 ||
      maybeStatusCode >= 500 ||
      maybeStatusCode === 429
    ) {
      return true;
    }

    return false;
  }

  private inferProviderErrorType(
    error: ProviderRequestError,
  ): ProviderRequestError['errorType'] {
    if (error.errorType) {
      return error.errorType;
    }

    const message = (error.message ?? '').toLowerCase();
    if (
      message.includes('out of memory') ||
      message.includes('cuda') ||
      message.includes('oom')
    ) {
      return 'TRANSIENT_OOM';
    }

    const statusCode = error.statusCode;
    if (statusCode === undefined || statusCode === 408 || statusCode === 425) {
      return 'TRANSIENT_TIMEOUT';
    }
    if (statusCode >= 500 || statusCode === 429) {
      return 'TRANSIENT_INFRA';
    }
    if (statusCode >= 400) {
      return 'PERMANENT_INPUT';
    }

    return 'TRANSIENT_INFRA';
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
