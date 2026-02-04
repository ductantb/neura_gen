import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { CommentsModule } from '../comments/comments.module';
import { RouterModule } from '@nestjs/core';
import { PostLikesModule } from '../post-likes/post-likes.module';

@Module({
  imports: [
    RouterModule.register([
      {
        path: 'posts/:postId',
        children: [
          {
            path: '/',
            module: CommentsModule,
          },
          {
            path: '/',
            module: PostLikesModule,
          },
        ],
      },
    ])
  ],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
