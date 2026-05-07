import { firstValueFrom, take, toArray } from 'rxjs';
import { JobEventsService } from './job-events.service';

describe('JobEventsService', () => {
  const flushAsync = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('subscribes to Redis channels and forwards published job events to stream subscribers', async () => {
    let redisMessageHandler:
      | ((channel: string, message: string) => void)
      | undefined;

    const subscriber = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(0),
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'message') {
          redisMessageHandler = handler as (
            channel: string,
            message: string,
          ) => void;
        }

        return subscriber;
      }),
      off: jest.fn(),
      disconnect: jest.fn(),
    };

    const publisher = {
      publish: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
      disconnect: jest.fn(),
    };

    const redis = {
      duplicate: jest
        .fn()
        .mockReturnValueOnce(subscriber)
        .mockReturnValueOnce(publisher),
    };

    const service = new JobEventsService(redis as any);

    const streamPromise = firstValueFrom(
      service.stream('job-1').pipe(take(1), toArray()),
    );

    await flushAsync();

    expect(subscriber.subscribe).toHaveBeenCalledWith('jobs:events:job-1');

    service.emitStatus({
      jobId: 'job-1',
      status: 'PROCESSING',
      progress: 60,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      occurredAt: '2026-04-01T00:00:00.000Z',
    });

    await flushAsync();

    expect(publisher.publish).toHaveBeenCalledWith(
      'jobs:events:job-1',
      expect.stringContaining('"type":"status"'),
    );

    expect(redisMessageHandler).toBeDefined();
    redisMessageHandler!(
      'jobs:events:job-1',
      JSON.stringify({
        jobId: 'job-1',
        type: 'status',
        data: {
          jobId: 'job-1',
          status: 'PROCESSING',
          progress: 60,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          failedAt: null,
          occurredAt: '2026-04-01T00:00:00.000Z',
        },
      }),
    );

    const [event] = await streamPromise;

    expect(event).toEqual(
      expect.objectContaining({
        jobId: 'job-1',
        type: 'status',
        data: expect.objectContaining({
          progress: 60,
        }),
      }),
    );
  });

  it('unsubscribes and disconnects cleanly when the last listener leaves', async () => {
    const subscriber = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(0),
      on: jest.fn(() => subscriber),
      off: jest.fn(),
      disconnect: jest.fn(),
    };

    const publisher = {
      publish: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
      disconnect: jest.fn(),
    };

    const redis = {
      duplicate: jest
        .fn()
        .mockReturnValueOnce(subscriber)
        .mockReturnValueOnce(publisher),
    };

    const service = new JobEventsService(redis as any);

    const subscription = service.stream('job-2').subscribe();

    await flushAsync();

    subscription.unsubscribe();
    await flushAsync();

    expect(subscriber.unsubscribe).toHaveBeenCalledWith('jobs:events:job-2');

    await service.onModuleDestroy();

    expect(subscriber.off).toHaveBeenCalled();
    expect(subscriber.disconnect).toHaveBeenCalled();
  });

  it('subscribes to user notification channels and forwards notification events', async () => {
    let redisMessageHandler:
      | ((channel: string, message: string) => void)
      | undefined;

    const subscriber = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(0),
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'message') {
          redisMessageHandler = handler as (
            channel: string,
            message: string,
          ) => void;
        }

        return subscriber;
      }),
      off: jest.fn(),
      disconnect: jest.fn(),
    };

    const publisher = {
      publish: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
      disconnect: jest.fn(),
    };

    const redis = {
      duplicate: jest
        .fn()
        .mockReturnValueOnce(subscriber)
        .mockReturnValueOnce(publisher),
    };

    const service = new JobEventsService(redis as any);

    const streamPromise = firstValueFrom(
      service.streamNotifications('user-1').pipe(take(1), toArray()),
    );

    await flushAsync();

    expect(subscriber.subscribe).toHaveBeenCalledWith(
      'jobs:notifications:user-1',
    );

    service.emitNotification({
      userId: 'user-1',
      jobId: 'job-1',
      kind: 'JOB_COMPLETED',
      severity: 'success',
      title: 'Video generation completed',
      message: 'Your video is ready to view and download.',
      status: 'COMPLETED',
      progress: 100,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
      presetId: 'standard_wan22_ti2v',
      workflow: 'T2V',
      errorMessage: null,
      resultReady: true,
      occurredAt: '2026-04-01T00:00:00.000Z',
    });

    await flushAsync();

    expect(publisher.publish).toHaveBeenCalledWith(
      'jobs:notifications:user-1',
      expect.stringContaining('"type":"notification"'),
    );

    expect(redisMessageHandler).toBeDefined();
    redisMessageHandler!(
      'jobs:notifications:user-1',
      JSON.stringify({
        userId: 'user-1',
        type: 'notification',
        data: {
          userId: 'user-1',
          jobId: 'job-1',
          kind: 'JOB_COMPLETED',
          severity: 'success',
          title: 'Video generation completed',
          message: 'Your video is ready to view and download.',
          status: 'COMPLETED',
          progress: 100,
          provider: 'modal',
          modelName: 'wan2.2-ti2v-standard',
          presetId: 'standard_wan22_ti2v',
          workflow: 'T2V',
          errorMessage: null,
          resultReady: true,
          occurredAt: '2026-04-01T00:00:00.000Z',
        },
      }),
    );

    const [event] = await streamPromise;

    expect(event).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        type: 'notification',
        data: expect.objectContaining({
          jobId: 'job-1',
          kind: 'JOB_COMPLETED',
        }),
      }),
    );
  });
});
