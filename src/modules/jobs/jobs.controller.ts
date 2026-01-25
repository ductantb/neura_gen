import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  // POST /jobs/video
  @Post('video')
  async createVideoJob(
    @Body() body: { userId: string; prompt: string },
  ) {
    return this.jobs.createVideoJob(body.userId, body.prompt);
  }

  // GET /jobs/:id
  @Get(':id')
  async getJob(@Param('id') id: string) {
    return this.jobs.getJobWithAssets(id);
  }
}
