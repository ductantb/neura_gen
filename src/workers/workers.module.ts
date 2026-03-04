import { Module } from '@nestjs/common';
import { VideoWorker } from './video.worker';

@Module({
  providers: [VideoWorker],
  exports: [VideoWorker],
})
export class WorkersModule {}