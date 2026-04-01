import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module';
import { VideoWorker } from 'src/workers/video.worker';
import { REDIS_CLIENT } from 'src/common/constants';
import { Redis } from 'ioredis';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const redis = app.get<Redis>(REDIS_CLIENT);
  const worker = app.get(VideoWorker);

  const started = await worker.start(redis);

  // eslint-disable-next-line no-console
  console.log(
    started
      ? ' Worker started'
      : 'Worker disabled because RUN_WORKER is not set to "true"',
  );
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('❌ Worker bootstrap failed', e);
  process.exit(1);
});
