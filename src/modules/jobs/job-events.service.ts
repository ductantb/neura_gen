import { Injectable } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { Observable, Subject } from 'rxjs';

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
  workflow: string | null;
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
};

export type JobLogPayload = {
  jobId: string;
  message: string;
  createdAt: string;
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
};

@Injectable()
export class JobEventsService {
  private readonly channels = new Map<string, JobEventChannel>();

  stream(jobId: string): Observable<JobStreamEvent> {
    return new Observable<JobStreamEvent>((subscriber) => {
      const channel = this.ensureChannel(jobId);
      channel.subscribers += 1;

      const subscription = channel.subject.subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
        channel.subscribers -= 1;

        if (channel.subscribers <= 0) {
          channel.subject.complete();
          this.channels.delete(jobId);
        }
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
    const channel = this.channels.get(event.jobId);
    channel?.subject.next(event);
  }

  private ensureChannel(jobId: string): JobEventChannel {
    const existing = this.channels.get(jobId);
    if (existing) {
      return existing;
    }

    const channel: JobEventChannel = {
      subject: new Subject<JobStreamEvent>(),
      subscribers: 0,
    };

    this.channels.set(jobId, channel);
    return channel;
  }
}
