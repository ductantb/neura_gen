import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { JobsController } from '../src/modules/jobs/jobs.controller';
import { JobEventsService } from '../src/modules/jobs/job-events.service';
import { JobsService } from '../src/modules/jobs/jobs.service';

describe('JobsController (e2e)', () => {
  let app: INestApplication<App>;

  const jobsService = {
    createVideoJob: jest.fn(),
    listMyJobs: jest.fn(),
    getJobWithAssets: jest.fn(),
    getJobResult: jest.fn(),
    getJobStreamSnapshot: jest.fn(),
    cancelJob: jest.fn(),
  };

  const jobEventsService = {
    stream: jest.fn(),
    streamNotifications: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        {
          provide: JobsService,
          useValue: jobsService,
        },
        {
          provide: JobEventsService,
          useValue: jobEventsService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        sub: 'user-1',
        email: 'user@example.com',
        username: 'tester',
        role: 'FREE',
      };
      next();
    });
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /jobs/video returns the created job payload', async () => {
    const responseBody = {
      jobId: 'job-1',
      status: 'QUEUED',
      creditCost: 10,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
      presetId: 'standard_wan22_ti2v',
      tier: 'standard',
      turboEnabled: false,
      estimatedDurationSeconds: 420,
      includeBackgroundAudio: true,
    };

    jobsService.createVideoJob.mockResolvedValue(responseBody);

    await request(app.getHttpServer())
      .post('/jobs/video')
      .send({
        prompt: 'Generate a cinematic sunset',
      })
      .expect(201)
      .expect(responseBody);

    expect(jobsService.createVideoJob).toHaveBeenCalledWith('user-1', {
      prompt: 'Generate a cinematic sunset',
    });
  });

  it('POST /jobs/:id/cancel returns the cancel payload', async () => {
    const responseBody = {
      jobId: 'job-1',
      status: 'CANCELLED',
      refundedCredit: 10,
    };

    jobsService.cancelJob.mockResolvedValue(responseBody);

    await request(app.getHttpServer())
      .post('/jobs/job-1/cancel')
      .expect(201)
      .expect(responseBody);

    expect(jobsService.cancelJob).toHaveBeenCalledWith('user-1', 'job-1');
  });

  it('GET /jobs/events/me streams notification SSE for the current user', async () => {
    jobEventsService.streamNotifications.mockReturnValue(
      of({
        userId: 'user-1',
        type: 'notification',
        data: {
          userId: 'user-1',
          jobId: 'job-1',
          kind: 'JOB_COMPLETED',
          severity: 'success',
          title: 'Video generation completed',
          message: 'Your video is ready to view and download.',
          status: 'COMPLETED',
          progress: 100,
          provider: 'modal',
          modelName: 'wan2.2-ti2v-standard',
          presetId: 'standard_wan22_ti2v',
          workflow: 'T2V',
          errorMessage: null,
          resultReady: true,
          occurredAt: '2026-05-07T00:00:00.000Z',
        },
      }),
    );

    const response = await request(app.getHttpServer())
      .get('/jobs/events/me')
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => callback(null, data));
      })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);

    expect(response.body).toContain('event: notification');
    expect(response.body).toContain('"kind":"JOB_COMPLETED"');
    expect(jobEventsService.streamNotifications).toHaveBeenCalledWith('user-1');
  });
});
