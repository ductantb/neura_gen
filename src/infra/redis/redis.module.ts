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

// old code: only support REDIS_URL
//         const url = process.env.REDIS_URL;
//         if (url && url.trim().length > 0) {
//           return new Redis(url, commonOpts);
//         }

// new code: support both REDIS_URL and REDIS_HOST/REDIS_PORT
        const host = process.env.REDIS_HOST || 'localhost';
        const port = Number(process.env.REDIS_PORT || 6379);

        return new Redis({ host, port, ...commonOpts });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}