import { Test, TestingModule } from '@nestjs/testing';
import { firstValueFrom, of, take, toArray } from 'rxjs';
import { JobsController } from './jobs.controller';
import { JobEventsService } from './job-events.service';
import { JobsService } from './jobs.service';

describe('JobsController', () => {
  let controller: JobsController;
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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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

    jest.clearAllMocks();
    controller = module.get<JobsController>(JobsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('streams an initial snapshot before live job events', async () => {
    jobsService.getJobStreamSnapshot.mockResolvedValue({
      jobId: 'job-1',
      status: 'PROCESSING',
      progress: 30,
      errorMessage: null,
      provider: 'modal',
      modelName: 'wan2.2-ti2v-standard',
      presetId: 'standard_wan22_ti2v',
      workflow: 'TI2V',
      createdAt: '2026-03-31T00:00:00.000Z',
      updatedAt: '2026-03-31T00:00:00.000Z',
      startedAt: '2026-03-31T00:00:00.000Z',
      completedAt: null,
      failedAt: null,
      logs: [],
    });
    jobEventsService.stream.mockReturnValue(
      of({
        jobId: 'job-1',
        type: 'status',
        data: {
          jobId: 'job-1',
          status: 'PROCESSING',
          progress: 60,
          errorMessage: null,
          startedAt: '2026-03-31T00:00:00.000Z',
          completedAt: null,
          failedAt: null,
          occurredAt: '2026-03-31T00:01:00.000Z',
        },
      }),
    );

    const events = await firstValueFrom(
      controller
        .streamJobEvents({ sub: 'user-1' } as any, 'job-1')
        .pipe(take(2), toArray()),
    );

    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'snapshot',
        data: expect.objectContaining({
          jobId: 'job-1',
          progress: 30,
        }),
      }),
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: 'status',
        data: expect.objectContaining({
          progress: 60,
        }),
      }),
    );
  });
});
