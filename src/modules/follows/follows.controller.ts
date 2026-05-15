import {
  Body,
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
import { CreateFollowDto } from './dto/create-follow.dto';

@ApiBearerAuth('access-token')
@Controller()
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @ApiOperation({ summary: 'Theo dõi một user' })
  @Post('follows')
  create(@Body() dto: CreateFollowDto, @CurrentUser() currentUser: JwtPayload) {
    return this.followsService.create(currentUser.sub, dto);
  }

  @ApiOperation({ summary: 'Danh sách followers của user' })
  @ApiQuery({ name: 'cursor', required: false, example: 1 })
  @ApiQuery({ name: 'take', required: false, example: 10 })
  @Get('users/:userId/followers')
  findFollowers(
    @Param('userId') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.followsService.findFollowers(userId, query);
  }

  @ApiOperation({ summary: 'Danh sách user mà user đang theo dõi' })
  @ApiQuery({ name: 'cursor', required: false, example: 1 })
  @ApiQuery({ name: 'take', required: false, example: 10 })
  @Get('users/:userId/followings')
  findFollowings(
    @Param('userId') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.followsService.findFollowings(userId, query);
  }

  @ApiOperation({ summary: 'Hủy theo dõi một user' })
  @ApiQuery({
    name: 'followerId',
    required: false,
    description:
      'Chỉ ADMIN: userId của người follower cần gỡ quan hệ follow với :userId.',
  })
  @Delete('follows/:userId')
  remove(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: JwtPayload,
    @Query('followerId') followerId?: string,
  ) {
    return this.followsService.remove(
      { followerId: currentUser.sub, role: currentUser.role },
      userId,
      followerId,
    );
  }
}
