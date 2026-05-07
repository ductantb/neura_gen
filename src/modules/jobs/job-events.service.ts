import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { REDIS_CLIENT } from 'src/common/constants';

export type JobEventType = 'snapshot' | 'status' | 'log' | 'heartbeat';

export type JobNotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export type JobNotificationKind =
  | 'JOB_QUEUED'
  | 'JOB_RETRYING'
  | 'JOB_PROVIDER_FALLBACK'
  | 'JOB_COMPLETED'
  | 'JOB_FAILED'
  | 'JOB_CANCELLED';

export type JobStreamLog = {
  jobId: string;
  message: string;
  createdAt: string;
};

export type JobSnapshotPayload = {
  jobId: string;
  status: JobStatus;
  progress: number;
  errorMessage: string | null;
  provider: string | null;
  modelName: string | null;
  presetId: string | null;
  tier: string | null;
  estimatedDurationSeconds: number | null;
  workflow: string | null;
  includeBackgroundAudio: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  logs: JobStreamLog[];
};

export type JobStatusPayload = {
  jobId: string;
  status: JobStatus;
  progress: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  occurredAt: string;
  provider?: string | null;
  providerAttempt?: number | null;
  fallbackTriggered?: boolean;
};

export type JobLogPayload = {
  jobId: string;
  message: string;
  createdAt: string;
  provider?: string | null;
  providerAttempt?: number | null;
  fallbackTriggered?: boolean;
};

export type JobHeartbeatPayload = {
  jobId: string;
  timestamp: string;
};

export type JobNotificationPayload = {
  userId: string;
  jobId: string;
  kind: JobNotificationKind;
  severity: JobNotificationSeverity;
  title: string;
  message: string;
  status: JobStatus;
  progress: number;
  provider: string | null;
  modelName: string | null;
  presetId: string | null;
  workflow: string | null;
  errorMessage: string | null;
  resultReady: boolean;
  occurredAt: string;
};

export type JobStreamEvent =
  | { jobId: string; type: 'snapshot'; data: JobSnapshotPayload }
  | { jobId: string; type: 'status'; data: JobStatusPayload }
  | { jobId: string; type: 'log'; data: JobLogPayload }
  | { jobId: string; type: 'heartbeat'; data: JobHeartbeatPayload };

export type JobNotificationEvent = {
  userId: string;
  type: 'notification';
  data: JobNotificationPayload;
};

type JobEventChannel = {
  subject: Subject<JobStreamEvent>;
  subscribers: number;
  redisSubscribed: boolean;
};

type JobNotificationChannel = {
  subject: Subject<JobNotificationEvent>;
  subscribers: number;
  redisSubscribed: boolean;
};

@Injectable()
export class JobEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobEventsService.name);
  private readonly jobChannels = new Map<string, JobEventChannel>();
  private readonly notificationChannels = new Map<
    string,
    JobNotificationChannel
  >();
  private publisher?: Redis;
  private subscriber?: Redis;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  stream(jobId: string): Observable<JobStreamEvent> {
    return new Observable<JobStreamEvent>((subscriber) => {
      const channel = this.ensureJobChannel(jobId);
      channel.subscribers += 1;

      const subscription = channel.subject.subscribe(subscriber);
      void this.ensureJobRedisSubscription(jobId);

      return () => {
        subscription.unsubscribe();
        void this.releaseJobRedisSubscription(jobId);
      };
    });
  }

  streamNotifications(userId: string): Observable<JobNotificationEvent> {
    return new Observable<JobNotificationEvent>((subscriber) => {
      const channel = this.ensureNotificationChannel(userId);
      channel.subscribers += 1;

      const subscription = channel.subject.subscribe(subscriber);
      void this.ensureNotificationRedisSubscription(userId);

      return () => {
        subscription.unsubscribe();
        void this.releaseNotificationRedisSubscription(userId);
      };
    });
  }

  emitSnapshot(data: JobSnapshotPayload) {
    this.emitJobEvent({
      jobId: data.jobId,
      type: 'snapshot',
      data,
    });
  }

  emitStatus(data: JobStatusPayload) {
    this.emitJobEvent({
      jobId: data.jobId,
      type: 'status',
      data,
    });
  }

  emitLog(data: JobLogPayload) {
    this.emitJobEvent({
      jobId: data.jobId,
      type: 'log',
      data,
    });
  }

  emitHeartbeat(jobId: string) {
    this.emitJobEvent({
      jobId,
      type: 'heartbeat',
      data: {
        jobId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  emitNotification(data: JobNotificationPayload) {
    this.emitNotificationEvent({
      userId: data.userId,
      type: 'notification',
      data,
    });
  }

  private emitJobEvent(event: JobStreamEvent) {
    this.publish(event).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown Redis publish error';
      this.logger.error(
        `Failed to publish job event for ${event.jobId}: ${message}`,
      );
    });
  }

  private emitNotificationEvent(event: JobNotificationEvent) {
    this.publish(event).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown Redis publish error';
      this.logger.error(
        `Failed to publish notification event for ${event.userId}: ${message}`,
      );
    });
  }

  private ensureJobChannel(jobId: string): JobEventChannel {
    const existing = this.jobChannels.get(jobId);
    if (existing) {
      return existing;
    }

    const channel: JobEventChannel = {
      subject: new Subject<JobStreamEvent>(),
      subscribers: 0,
      redisSubscribed: false,
    };

    this.jobChannels.set(jobId, channel);
    return channel;
  }

  private ensureNotificationChannel(userId: string): JobNotificationChannel {
    const existing = this.notificationChannels.get(userId);
    if (existing) {
      return existing;
    }

    const channel: JobNotificationChannel = {
      subject: new Subject<JobNotificationEvent>(),
      subscribers: 0,
      redisSubscribed: false,
    };

    this.notificationChannels.set(userId, channel);
    return channel;
  }

  private async ensureJobRedisSubscription(jobId: string) {
    const channel = this.ensureJobChannel(jobId);
    if (channel.redisSubscribed) {
      return;
    }

    const subscriber = this.getSubscriber();
    await subscriber.subscribe(this.getJobRedisChannel(jobId));
    channel.redisSubscribed = true;
  }

  private async ensureNotificationRedisSubscription(userId: string) {
    const channel = this.ensureNotificationChannel(userId);
    if (channel.redisSubscribed) {
      return;
    }

    const subscriber = this.getSubscriber();
    await subscriber.subscribe(this.getNotificationRedisChannel(userId));
    channel.redisSubscribed = true;
  }

  private async releaseJobRedisSubscription(jobId: string) {
    const channel = this.jobChannels.get(jobId);
    if (!channel) {
      return;
    }

    channel.subscribers -= 1;
    if (channel.subscribers > 0) {
      return;
    }

    try {
      if (channel.redisSubscribed) {
        await this.getSubscriber().unsubscribe(this.getJobRedisChannel(jobId));
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown Redis unsubscribe error';
      this.logger.error(
        `Failed to unsubscribe Redis channel for ${jobId}: ${message}`,
      );
    } finally {
      channel.redisSubscribed = false;
      channel.subject.complete();
      this.jobChannels.delete(jobId);
    }
  }

  private async releaseNotificationRedisSubscription(userId: string) {
    const channel = this.notificationChannels.get(userId);
    if (!channel) {
      return;
    }

    channel.subscribers -= 1;
    if (channel.subscribers > 0) {
      return;
    }

    try {
      if (channel.redisSubscribed) {
        await this.getSubscriber().unsubscribe(
          this.getNotificationRedisChannel(userId),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown Redis unsubscribe error';
      this.logger.error(
        `Failed to unsubscribe notification Redis channel for ${userId}: ${message}`,
      );
    } finally {
      channel.redisSubscribed = false;
      channel.subject.complete();
      this.notificationChannels.delete(userId);
    }
  }

  private async publish(event: JobStreamEvent | JobNotificationEvent) {
    const publisher = this.getPublisher();
    const channelName =
      'jobId' in event
        ? this.getJobRedisChannel(event.jobId)
        : this.getNotificationRedisChannel(event.userId);

    await publisher.publish(channelName, JSON.stringify(event));
  }

  private getPublisher() {
    if (!this.publisher) {
      this.publisher = this.redis.duplicate();
      this.publisher.on('error', (error) => {
        this.logger.error(`Redis publisher error: ${error.message}`);
      });
    }

    return this.publisher;
  }

  private getSubscriber() {
    if (!this.subscriber) {
      this.subscriber = this.redis.duplicate();
      this.subscriber.on('message', this.handleRedisMessage);
      this.subscriber.on('error', (error) => {
        this.logger.error(`Redis subscriber error: ${error.message}`);
      });
    }

    return this.subscriber;
  }

  private readonly handleRedisMessage = (
    channelName: string,
    message: string,
  ) => {
    if (channelName.startsWith('jobs:events:')) {
      this.forwardJobEvent(channelName, message);
      return;
    }

    if (channelName.startsWith('jobs:notifications:')) {
      this.forwardNotificationEvent(channelName, message);
    }
  };

  private forwardJobEvent(channelName: string, message: string) {
    const jobId = this.getJobIdFromChannel(channelName);
    if (!jobId) {
      return;
    }

    const channel = this.jobChannels.get(jobId);
    if (!channel) {
      return;
    }

    try {
      const event = JSON.parse(message) as JobStreamEvent;
      channel.subject.next(event);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Unknown JSON parse error';
      this.logger.error(
        `Failed to parse Redis SSE payload for ${jobId}: ${reason}`,
      );
    }
  }

  private forwardNotificationEvent(channelName: string, message: string) {
    const userId = this.getUserIdFromNotificationChannel(channelName);
    if (!userId) {
      return;
    }

    const channel = this.notificationChannels.get(userId);
    if (!channel) {
      return;
    }

    try {
      const event = JSON.parse(message) as JobNotificationEvent;
      channel.subject.next(event);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Unknown JSON parse error';
      this.logger.error(
        `Failed to parse Redis notification payload for ${userId}: ${reason}`,
      );
    }
  }

  private getJobRedisChannel(jobId: string) {
    return `jobs:events:${jobId}`;
  }

  private getNotificationRedisChannel(userId: string) {
    return `jobs:notifications:${userId}`;
  }

  private getJobIdFromChannel(channelName: string) {
    const prefix = 'jobs:events:';
    return channelName.startsWith(prefix)
      ? channelName.slice(prefix.length)
      : null;
  }

  private getUserIdFromNotificationChannel(channelName: string) {
    const prefix = 'jobs:notifications:';
    return channelName.startsWith(prefix)
      ? channelName.slice(prefix.length)
      : null;
  }

  async onModuleDestroy() {
    for (const channel of this.jobChannels.values()) {
      channel.subject.complete();
    }
    this.jobChannels.clear();

    for (const channel of this.notificationChannels.values()) {
      channel.subject.complete();
    }
    this.notificationChannels.clear();

    if (this.subscriber) {
      this.subscriber.off('message', this.handleRedisMessage);
      this.subscriber.disconnect();
      this.subscriber = undefined;
    }

    if (this.publisher) {
      this.publisher.disconnect();
      this.publisher = undefined;
    }
  }
}
