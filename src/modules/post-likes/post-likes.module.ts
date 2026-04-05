import { Module } from '@nestjs/common';
import { PostLikesService } from './post-likes.service';
import { PostLikesController } from './post-likes.controller';
import { ExploreModule } from '../explore/explore.module';

@Module({
  imports: [ExploreModule],
  controllers: [PostLikesController],
  providers: [PostLikesService],
})
export class PostLikesModule {}
