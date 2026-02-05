import {
  Controller,
  Get,
  Post,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { FollowsService } from './follows.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';

@Controller()
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post('follows')
  create(@Param('userId') userId: string, @CurrentUser() currentUser: JwtPayload) {
    return this.followsService.create({ followingId: userId, followerId: currentUser.sub });
  }

  @Get('followers')
  findFollowers(@Param('userId') userId: string, @Query() query: PaginationDto) {
    return this.followsService.findFollowers(userId, query);
  }

  @Get('followings')
  findFollowings(@Param('userId') userId: string, @Query() query: PaginationDto) {
    return this.followsService.findFollowings(userId, query);
  }

  @Delete('follows')
  remove(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: JwtPayload
  ) {
    return this.followsService.remove(currentUser.sub, userId);
  }
}
