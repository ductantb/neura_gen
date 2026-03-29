import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  // POST /jobs/video
  @Post('video')
  async createVideoJob(
    @Req() req: any,
    @Body() body: { userId: string; prompt: string },
  ) {
    // log test bug
    console.log('req.user =', req.user);
    console.log('req.user.sub =', req.user?.sub);
    return this.jobs.createVideoJob(req.user.sub, body.prompt);
  }

  // GET /jobs/:id
  @Get(':id')
  async getJob(@Param('id') id: string) {
    return this.jobs.getJobWithAssets(id);
  }
}
