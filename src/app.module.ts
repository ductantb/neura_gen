import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { ModalModule } from './modules/modal/modal.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobsModule } from './modules/jobs/jobs.module';
import { PostsModule } from './modules/posts/posts.module';
import { UsersModule } from './modules/users/users.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './common/guards/roles.guard';
import { AssetsModule } from './modules/assets/assets.module';
import { RedisModule } from './infra/redis/redis.module';
import { ScheduleModule } from '@nestjs/schedule';
import { GalleryModule } from './modules/gallery/gallery.module';
import { ExploreModule } from './modules/explore/explore.module';
import { WorkersModule } from './workers/workers.module';
import { QueueModule } from './infra/queue/queue.module';
import { StorageModule } from './infra/storage/storage.module';
import { BillingModule } from './modules/billing/billing.module';
import { FollowsModule } from './modules/follows/follows.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggingModule } from './infra/logging/logging.module';
import { RequestLoggingMiddleware } from './infra/logging/request-logging.middleware';
import { OpsModule } from './modules/ops/ops.module';

@Module({
  controllers: [AppController],
  imports: [
    LoggingModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    ModalModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          name: 'default',
          ttl: Number(configService.get('THROTTLE_TTL_MS') ?? 60_000),
          limit: Number(configService.get('THROTTLE_LIMIT') ?? 120),
        },
      ],
    }),
    ScheduleModule.forRoot(),
    JobsModule,
    PostsModule,
    UsersModule,
    AssetsModule,
    GalleryModule,
    ExploreModule,
    QueueModule,
    WorkersModule,
    StorageModule,
    BillingModule,
    FollowsModule,
    OpsModule,
  ],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
