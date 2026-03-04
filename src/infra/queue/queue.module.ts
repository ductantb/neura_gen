import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { REDIS_CLIENT, VIDEO_QUEUE } from 'src/common/constants';
import { Redis } from 'ioredis';
import { RedisModule } from 'src/infra/redis/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: VIDEO_QUEUE,
      useFactory: (redis: Redis) => {
        const queueName = process.env.VIDEO_QUEUE_NAME || 'video-gen';
        return new Queue(queueName, { connection: redis });
      },
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [VIDEO_QUEUE],
})
export class QueueModule {}