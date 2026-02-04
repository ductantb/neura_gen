import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { FollowsService } from './follows.service';
import { CreateFollowDto } from './dto/create-follow.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post()
  create(@Body() createFollowDto: CreateFollowDto) {
    return this.followsService.create(createFollowDto);
  }

  @Get('users')
  findUsers(@Param('userId') userId: string, @Query() query: PaginationDto) {
    return this.followsService.findUsers(userId, query);
  }

  @Delete(':followerId/:followingId')
  remove(
    @Param('followerId') followerId: string,
    @Param('followingId') followingId: string,
  ) {
    return this.followsService.remove(followerId, followingId);
  }
}
