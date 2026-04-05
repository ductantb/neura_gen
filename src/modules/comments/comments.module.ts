import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { ExploreModule } from '../explore/explore.module';

@Module({
  imports: [ExploreModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
