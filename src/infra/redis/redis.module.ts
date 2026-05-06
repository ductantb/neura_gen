import { Global, Module } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { REDIS_CLIENT } from 'src/common/constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const commonOpts: RedisOptions = {
          maxRetriesPerRequest: null, //for BullMQ
          enableReadyCheck: false,
        };

        const url = process.env.REDIS_URL?.trim();
        if (url) {
          return new Redis(url, commonOpts);
        }

        const host = process.env.REDIS_HOST || process.env.REDISHOST || 'localhost';
        const port = Number(process.env.REDIS_PORT || process.env.REDISPORT || 6379);
        const username = process.env.REDIS_USER || process.env.REDISUSER;
        const password = process.env.REDIS_PASSWORD || process.env.REDISPASSWORD;

        return new Redis({
          host,
          port,
          username: username || undefined,
          password: password || undefined,
          ...commonOpts,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
