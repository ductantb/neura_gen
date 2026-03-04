import { Queue } from 'bullmq';
import { QUEUE_VIDEO } from './queue.constants';
import { RedisService } from '../redis/redis.service';

export const VIDEO_QUEUE = Symbol('VIDEO_QUEUE');

export const queueProviders = [
  {
    provide: VIDEO_QUEUE,
    useFactory: (redis: RedisService) => {
      return new Queue(QUEUE_VIDEO, { connection: redis.client });
    },
    inject: [RedisService],
  },
];