import { Body, Controller, Get, Param, Post, Req, BadRequestException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateVideoJobDto } from './dto/create-job.dto';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  // POST /jobs/video
  @Post('video')
  async createVideoJob(@Req() req, @Body() dto: CreateVideoJobDto) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException("User not authenticated");
    }
    return this.jobs.createVideoJob(userId, dto);
  }

  // GET /jobs/:id
  @Get(':id')
  async getJob(@Req() req, @Param('id') id: string) {
    return this.jobs.getJobWithAssets(id);
  }

}
