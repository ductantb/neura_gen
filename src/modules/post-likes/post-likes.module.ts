import { Module } from '@nestjs/common';
import { PostLikesService } from './post-likes.service';
import { PostLikesController } from './post-likes.controller';

@Module({
  controllers: [PostLikesController],
  providers: [PostLikesService],
})
export class PostLikesModule {}
