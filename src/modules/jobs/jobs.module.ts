import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobEventsService } from './job-events.service';
import { JobsService } from './jobs.service';
import { QueueModule } from 'src/infra/queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [JobsController],
  providers: [JobsService, JobEventsService],
  exports: [JobsService, JobEventsService],
})
export class JobsModule {}
