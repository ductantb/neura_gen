import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OpsService } from './modules/ops/ops.service';

describe('AppController', () => {
  let appController: AppController;
  const opsService = {
    assertReadyOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: OpsService,
          useValue: opsService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('should return ok=true when database and redis are healthy', async () => {
      opsService.assertReadyOrThrow.mockResolvedValue({
        ok: true,
        timestamp: new Date().toISOString(),
        checks: {
          database: true,
          redis: true,
        },
      });

      const result = await appController.getHealth();

      expect(result.ok).toBe(true);
      expect(result.checks.database).toBe(true);
      expect(result.checks.redis).toBe(true);
    });

    it('should throw 503 when one dependency is unhealthy', async () => {
      opsService.assertReadyOrThrow.mockRejectedValue(
        new ServiceUnavailableException({
          ok: false,
        }),
      );

      await expect(appController.getHealth()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
