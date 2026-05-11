import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { REDIS_CLIENT, VIDEO_QUEUE } from 'src/common/constants';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(VIDEO_QUEUE) private readonly videoQueue: Queue,
  ) {}

  async getMetrics(opsTokenFromHeader?: string) {
    this.assertMetricsAccess(opsTokenFromHeader);

    const [database, redis, queue, processMetrics] = await Promise.all([
      this.getDatabaseHealth(),
      this.getRedisHealth(),
      this.getQueueMetrics(),
      this.getProcessMetrics(),
    ]);

    return {
      ok: database.ok && redis.ok,
      timestamp: new Date().toISOString(),
      service: 'api',
      deployment: this.getDeploymentFingerprint(),
      process: processMetrics,
      dependencies: {
        database,
        redis,
      },
      queue,
    };
  }

  async assertReadyOrThrow() {
    const [database, redis] = await Promise.all([
      this.getDatabaseHealth(),
      this.getRedisHealth(),
    ]);

    const ok = database.ok && redis.ok;
    const payload = {
      ok,
      timestamp: new Date().toISOString(),
      deployment: this.getDeploymentFingerprint(),
      checks: {
        database: database.ok,
        redis: redis.ok,
      },
      details: {
        database: database.message,
        redis: redis.message,
      },
    };

    if (!ok) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }

  private getDeploymentFingerprint() {
    return {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      branch: process.env.RAILWAY_GIT_BRANCH ?? null,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
      serviceId: process.env.RAILWAY_SERVICE_ID ?? null,
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? null,
    };
  }

  private async getDatabaseHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, message: 'ok' };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'database check failed',
      };
    }
  }

  private async getRedisHealth() {
    try {
      const pong = await this.redis.ping();
      return {
        ok: pong === 'PONG',
        message: pong === 'PONG' ? 'ok' : `unexpected redis ping response: ${pong}`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'redis check failed',
      };
    }
  }

  private async getQueueMetrics() {
    let counts: Record<string, number>;
    try {
      counts = await this.videoQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      );
    } catch (error) {
      return {
        name: this.videoQueue.name,
        ok: false,
        error: error instanceof Error ? error.message : 'queue metrics failed',
      };
    }

    return {
      name: this.videoQueue.name,
      ok: true,
      counts,
    };
  }

  private getProcessMetrics() {
    const memory = process.memoryUsage();
    return {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      memory: {
        rssBytes: memory.rss,
        heapTotalBytes: memory.heapTotal,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
      },
    };
  }

  private assertMetricsAccess(opsTokenFromHeader?: string) {
    const configuredToken = process.env.OPS_METRICS_TOKEN?.trim();
    if (!configuredToken) {
      return;
    }

    if (opsTokenFromHeader === configuredToken) {
      return;
    }

    throw new ForbiddenException(
      'Missing or invalid metrics token. Provide x-ops-token header.',
    );
  }
}
