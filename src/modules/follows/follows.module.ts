import { Module } from '@nestjs/common';
import { FollowsService } from './follows.service';
import { FollowsController } from './follows.controller';
import { ExploreModule } from '../explore/explore.module';

@Module({
  imports: [ExploreModule],
  controllers: [FollowsController],
  providers: [FollowsService],
})
export class FollowsModule {}
