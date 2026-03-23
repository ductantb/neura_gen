import {
  Controller,
  Get,
  Param,
  Post,
  Body,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateVideoJobDto } from './dto/create-job.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

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

  @Post(':id/cancel')
  async cancelJob(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.jobs.cancelJob(user.sub, id);
  }
}