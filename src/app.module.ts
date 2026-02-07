import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './database/prisma.module';
import { ModalModule } from './modules/modal/modal.module';
import { ConfigModule } from '@nestjs/config';
import { JobsController } from './modules/jobs/jobs.controller';
import { JobsModule } from './modules/jobs/jobs.module';
import { PostsModule } from './modules/posts/posts.module';
import { UsersModule } from './modules/users/users.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './common/guards/roles.guard';
import { AssetsModule } from './modules/assets/assets.module';
import { RedisModule } from './database/redis.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    ModalModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    JobsModule,
    PostsModule,
    UsersModule,
    AssetsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  controllers: [JobsController],
})
export class AppModule {}
