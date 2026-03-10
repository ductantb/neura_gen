import { Module } from '@nestjs/common';
import { VideoWorker } from './video.worker';
import { ModalModule } from 'src/modules/modal/modal.module';

@Module({
  imports: [ModalModule],
  providers: [VideoWorker],
  exports: [VideoWorker],
})
export class WorkersModule {}