import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { REDIS_CLIENT } from 'src/common/constants';

export type JobEventType = 'snapshot' | 'status' | 'log' | 'heartbeat';

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

export type JobStreamEvent =
  | { jobId: string; type: 'snapshot'; data: JobSnapshotPayload }
  | { jobId: string; type: 'status'; data: JobStatusPayload }
  | { jobId: string; type: 'log'; data: JobLogPayload }
  | { jobId: string; type: 'heartbeat'; data: JobHeartbeatPayload };

type JobEventChannel = {
  subject: Subject<JobStreamEvent>;
  subscribers: number;
  redisSubscribed: boolean;
};

@Injectable()
export class JobEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobEventsService.name);
  private readonly channels = new Map<string, JobEventChannel>();
  private publisher?: Redis;
  private subscriber?: Redis;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  stream(jobId: string): Observable<JobStreamEvent> {
    return new Observable<JobStreamEvent>((subscriber) => {
      const channel = this.ensureChannel(jobId);
      channel.subscribers += 1;

      const subscription = channel.subject.subscribe(subscriber);
      void this.ensureRedisSubscription(jobId);

      return () => {
        subscription.unsubscribe();
        void this.releaseRedisSubscription(jobId);
      };
    });
  }

  emitSnapshot(data: JobSnapshotPayload) {
    this.emit({
      jobId: data.jobId,
      type: 'snapshot',
      data,
    });
  }

  emitStatus(data: JobStatusPayload) {
    this.emit({
      jobId: data.jobId,
      type: 'status',
      data,
    });
  }

  emitLog(data: JobLogPayload) {
    this.emit({
      jobId: data.jobId,
      type: 'log',
      data,
    });
  }

  emitHeartbeat(jobId: string) {
    this.emit({
      jobId,
      type: 'heartbeat',
      data: {
        jobId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private emit(event: JobStreamEvent) {
    this.publish(event).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown Redis publish error';
      this.logger.error(
        `Failed to publish job event for ${event.jobId}: ${message}`,
      );
    });
  }

  private ensureChannel(jobId: string): JobEventChannel {
    const existing = this.channels.get(jobId);
    if (existing) {
      return existing;
    }

    const channel: JobEventChannel = {
      subject: new Subject<JobStreamEvent>(),
      subscribers: 0,
      redisSubscribed: false,
    };

    this.channels.set(jobId, channel);
    return channel;
  }

  private async ensureRedisSubscription(jobId: string) {
    const channel = this.ensureChannel(jobId);
    if (channel.redisSubscribed) {
      return;
    }

    const subscriber = this.getSubscriber();
    await subscriber.subscribe(this.getRedisChannel(jobId));
    channel.redisSubscribed = true;
  }

  private async releaseRedisSubscription(jobId: string) {
    const channel = this.channels.get(jobId);
    if (!channel) {
      return;
    }

    channel.subscribers -= 1;
    if (channel.subscribers > 0) {
      return;
    }

    try {
      if (channel.redisSubscribed) {
        await this.getSubscriber().unsubscribe(this.getRedisChannel(jobId));
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
      this.channels.delete(jobId);
    }
  }

  private async publish(event: JobStreamEvent) {
    const publisher = this.getPublisher();
    await publisher.publish(
      this.getRedisChannel(event.jobId),
      JSON.stringify(event),
    );
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
    const jobId = this.getJobIdFromChannel(channelName);
    if (!jobId) {
      return;
    }

    const channel = this.channels.get(jobId);
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
  };

  private getRedisChannel(jobId: string) {
    return `jobs:events:${jobId}`;
  }

  private getJobIdFromChannel(channelName: string) {
    const prefix = 'jobs:events:';
    return channelName.startsWith(prefix)
      ? channelName.slice(prefix.length)
      : null;
  }

  async onModuleDestroy() {
    for (const channel of this.channels.values()) {
      channel.subject.complete();
    }
    this.channels.clear();

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
