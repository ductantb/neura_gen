import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { OpsService } from '../src/modules/ops/ops.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const appService = {
    getHello: jest.fn(),
  };
  const opsService = {
    assertReadyOrThrow: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: appService,
        },
        {
          provide: OpsService,
          useValue: opsService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    appService.getHello.mockReturnValue('Hello World!');
    opsService.assertReadyOrThrow.mockResolvedValue({
      ok: true,
      timestamp: '2026-05-07T00:00:00.000Z',
      checks: {
        database: true,
        redis: true,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET)', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({
        ok: true,
        timestamp: '2026-05-07T00:00:00.000Z',
        checks: {
          database: true,
          redis: true,
        },
      });
  });
});
