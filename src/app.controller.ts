import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { OpsService } from './modules/ops/ops.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly opsService: OpsService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get('health')
  async getHealth() {
    try {
      return await this.opsService.assertReadyOrThrow();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException({
        ok: false,
        timestamp: new Date().toISOString(),
        checks: {
          database: false,
          redis: false,
        },
        details: {
          message:
            error instanceof Error
              ? error.message
              : 'unexpected healthcheck failure',
        },
      });
    }
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
