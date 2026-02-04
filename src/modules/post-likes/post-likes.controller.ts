import { Controller, Get, Post, Body, Param, Delete, Query, Req } from '@nestjs/common';
import { PostLikesService } from './post-likes.service';
import { CreatePostLikeDto } from './dto/create-post-like.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';

@Controller('post-likes')
export class PostLikesController {
  constructor(private readonly postLikesService: PostLikesService) {}

  @Post()
  create(@Body() createPostLikeDto: CreatePostLikeDto) {
    return this.postLikesService.create(createPostLikeDto);
  }

  @Get()
  findUsers(
    @Param('postId') postId: string,
    @Query() query: PaginationDto,
  ) {
    return this.postLikesService.findUsers(postId, query);
  }

  @Delete()
  remove(@Param('postId') postId: string, @CurrentUser() user: JwtPayload) {
    return this.postLikesService.remove(user.sub, postId);
  }
}
