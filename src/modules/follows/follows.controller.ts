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
import { ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiBearerAuth('access-token')
@Controller()
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @ApiOperation({ summary: 'Theo dõi một user' })
  @Post('follows')
  create(@Param('userId') userId: string, @CurrentUser() currentUser: JwtPayload) {
    return this.followsService.create({ followingId: userId, followerId: currentUser.sub });
  }

  @ApiOperation({ summary: 'Danh sách followers của user' })
  @ApiQuery({ name: 'cursor', required: false, example: 1 })
  @ApiQuery({ name: 'take', required: false, example: 10 })
  @Get('followers')
  findFollowers(@Param('userId') userId: string, @Query() query: PaginationDto) {
    return this.followsService.findFollowers(userId, query);
  }

  @ApiOperation({ summary: 'Danh sách user mà user đang theo dõi' })
  @ApiQuery({ name: 'cursor', required: false, example: 1 })
  @ApiQuery({ name: 'take', required: false, example: 10 })
  @Get('followings')
  findFollowings(@Param('userId') userId: string, @Query() query: PaginationDto) {
    return this.followsService.findFollowings(userId, query);
  }

  @ApiOperation({ summary: 'Hủy theo dõi một user' })
  @Delete('follows')
  remove(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: JwtPayload
  ) {
    return this.followsService.remove({ followerId: currentUser.sub, role: currentUser.role }, userId);
  }
}
