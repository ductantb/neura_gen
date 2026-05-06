import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { OpsService } from './ops.service';

describe('OpsService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
  };

  const redis = {
    ping: jest.fn(),
  };

  const videoQueue = {
    name: 'video-gen',
    getJobCounts: jest.fn(),
  };

  let service: OpsService;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    service = new OpsService(prisma as any, redis as any, videoQueue as any);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns metrics when dependencies are healthy', async () => {
    prisma.$queryRaw.mockResolvedValue([1]);
    redis.ping.mockResolvedValue('PONG');
    videoQueue.getJobCounts.mockResolvedValue({
      waiting: 1,
      active: 2,
      completed: 3,
      failed: 4,
      delayed: 0,
      paused: 0,
    });

    const metrics = await service.getMetrics();

    expect(metrics.ok).toBe(true);
    expect(metrics.dependencies.database.ok).toBe(true);
    expect(metrics.dependencies.redis.ok).toBe(true);
    expect(metrics.queue.ok).toBe(true);
  });

  it('throws forbidden when OPS_METRICS_TOKEN is configured and header is missing', async () => {
    process.env.OPS_METRICS_TOKEN = 'secret-token';
    prisma.$queryRaw.mockResolvedValue([1]);
    redis.ping.mockResolvedValue('PONG');
    videoQueue.getJobCounts.mockResolvedValue({});

    await expect(service.getMetrics()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes when OPS_METRICS_TOKEN matches', async () => {
    process.env.OPS_METRICS_TOKEN = 'secret-token';
    prisma.$queryRaw.mockResolvedValue([1]);
    redis.ping.mockResolvedValue('PONG');
    videoQueue.getJobCounts.mockResolvedValue({});

    const metrics = await service.getMetrics('secret-token');
    expect(metrics.ok).toBe(true);
  });

  it('throws 503 in readiness check when a dependency is unhealthy', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    redis.ping.mockResolvedValue('PONG');

    await expect(service.assertReadyOrThrow()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
