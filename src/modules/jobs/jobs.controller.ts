import { Controller,Get,MessageEvent,Param,Post,Body,Sse,} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateVideoJobDto } from './dto/create-job.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { JobEventsService, type JobStreamEvent } from './job-events.service';
import { concat, defer, from, map, merge, mergeMap, of, timer, type Observable,} from 'rxjs';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly jobEvents: JobEventsService,
  ) {}

  @Post('video')
  async createVideoJob(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoJobDto,
  ) {
    return this.jobs.createVideoJob(user.sub, dto);
  }

  @Get()
  async listMyJobs(@CurrentUser() user: JwtPayload) {
    return this.jobs.listMyJobs(user.sub);
  }

  @Get(':id')
  async getJob(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.jobs.getJobWithAssets(user.sub, id);
  }

  @Get(':id/result')
  async getJobResult(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.jobs.getJobResult(user.sub, id);
  }

  @Sse(':id/events')
  streamJobEvents(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Observable<MessageEvent> {
    return defer(() =>
      from(this.jobs.getJobStreamSnapshot(user.sub, id)).pipe(
        mergeMap((snapshot) => {
          const updates$ = this.jobEvents
            .stream(id)
            .pipe(map((event) => this.toMessageEvent(event)));

          const heartbeats$ = timer(15000, 15000).pipe(
            map(() =>
              this.toMessageEvent({
                jobId: id,
                type: 'heartbeat',
                data: {
                  jobId: id,
                  timestamp: new Date().toISOString(),
                },
              }),
            ),
          );

          return concat(
            of(
              this.toMessageEvent({
                jobId: id,
                type: 'snapshot',
                data: snapshot,
              }),
            ),
            merge(updates$, heartbeats$),
          );
        }),
      ),
    );
  }

  @Post(':id/cancel')
  async cancelJob(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.jobs.cancelJob(user.sub, id);
  }

  private toMessageEvent(event: JobStreamEvent): MessageEvent {
    return {
      type: event.type,
      data: event.data,
    };
  }
}
