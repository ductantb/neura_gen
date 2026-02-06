import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { REDIS_CLIENT } from 'src/database/redis.module';

export const VIDEO_QUEUE = Symbol('VIDEO_QUEUE');

@Module({
  imports: [HttpModule],
  controllers: [JobsController],
  providers: [
    JobsService,
    {
      provide: VIDEO_QUEUE,
      useFactory: (redis: Redis) =>
        new Queue('video-gen', { connection: redis }),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [JobsService],
})
export class JobsModule {}
