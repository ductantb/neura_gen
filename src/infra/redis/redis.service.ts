import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  public readonly client: Redis;

  constructor() {
    const url = process.env.REDIS_URL?.trim();
    if (url) {
      this.client = new Redis(url, {
        maxRetriesPerRequest: null, // recommended for BullMQ
      });
      return;
    }

    const host = process.env.REDIS_HOST || process.env.REDISHOST || 'localhost';
    const port = Number(process.env.REDIS_PORT || process.env.REDISPORT || 6379);
    const username = process.env.REDIS_USER || process.env.REDISUSER;
    const password = process.env.REDIS_PASSWORD || process.env.REDISPASSWORD;

    this.client = new Redis({
      host,
      port,
      username: username || undefined,
      password: password || undefined,
      maxRetriesPerRequest: null, // recommended for BullMQ
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
