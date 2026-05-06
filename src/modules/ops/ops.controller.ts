import { Controller, Get, Headers } from '@nestjs/common';
import { Public } from 'src/common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { OpsService } from './ops.service';

@Controller('ops')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Public()
  @SkipThrottle()
  @Get('metrics')
  getMetrics(@Headers('x-ops-token') opsToken?: string) {
    return this.opsService.getMetrics(opsToken);
  }
}
