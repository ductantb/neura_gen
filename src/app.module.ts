import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { ModalModule } from './modules/modal/modal.module';
import { ConfigModule } from '@nestjs/config';
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
    GalleryModule,
    ExploreModule,
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
})
export class AppModule {}
