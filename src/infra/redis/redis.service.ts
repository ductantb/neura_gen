import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  public readonly client: Redis;

  constructor() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT || 6379);

    this.client = new Redis({
      host,
      port,
      maxRetriesPerRequest: null, // recommended for BullMQ
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}