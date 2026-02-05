import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './database/prisma.module';
import { ModalModule } from './modules/modal/modal.module';
import { ConfigModule } from '@nestjs/config';
import { JobsService } from './modules/jobs/jobs.service';
import { JobsController } from './modules/jobs/jobs.controller';
import { JobsModule } from './modules/jobs/jobs.module';
import { PostsModule } from './modules/posts/posts.module';
import { CommentsModule } from './modules/comments/comments.module';
import { PostLikesModule } from './modules/post-likes/post-likes.module';
import { FollowsModule } from './modules/follows/follows.module';
import { UsersModule } from './modules/users/users.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './common/guards/roles.guard';
import { AssetsModule } from './modules/assets/assets.module';
import { CaslModule } from './modules/casl/casl.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ModalModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    JobsModule,
    PostsModule,
    UsersModule,
    AssetsModule,
    CaslModule,
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
    JobsService
  ],
  controllers: [JobsController],
})
export class AppModule {}
