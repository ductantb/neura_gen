import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module';
import { VideoWorker } from 'src/workers/video.worker';
import { REDIS_CLIENT } from 'src/common/constants';
import { Redis } from 'ioredis';
import { StructuredLoggerService } from 'src/infra/logging/structured-logger.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const redis = app.get<Redis>(REDIS_CLIENT);
  const worker = app.get(VideoWorker);
  const logger = app.get(StructuredLoggerService);

  const started = await worker.start(redis);

  if (started) {
    logger.info('worker.bootstrap.started', {
      runWorker: process.env.RUN_WORKER ?? null,
      queueName: process.env.VIDEO_QUEUE_NAME ?? 'video-gen',
    });
    return;
  }

  logger.warn('worker.bootstrap.disabled', {
    runWorker: process.env.RUN_WORKER ?? null,
  });
}

bootstrap().catch((e) => {
  const message = e instanceof Error ? e.message : 'unknown worker bootstrap error';
  const stack = e instanceof Error ? e.stack : undefined;
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'worker.bootstrap.failed',
      message,
      stack,
    }),
  );
  process.exit(1);
});
