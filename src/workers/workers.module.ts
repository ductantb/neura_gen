import { Module } from '@nestjs/common';
import { VideoWorker } from './video.worker';
import { ModalModule } from 'src/modules/modal/modal.module';
import { StorageModule } from 'src/infra/storage/storage.module';
import { AssetsModule } from 'src/modules/assets/assets.module';
import { JobsModule } from 'src/modules/jobs/jobs.module';

@Module({
  imports: [ModalModule, AssetsModule, StorageModule, JobsModule],
  providers: [VideoWorker],
  exports: [VideoWorker],
})
export class WorkersModule {}
