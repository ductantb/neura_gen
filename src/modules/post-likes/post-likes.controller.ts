import { Controller, Get, Post, Body, Param, Delete, Query, Req } from '@nestjs/common';
import { PostLikesService } from './post-likes.service';
import { CreatePostLikeDto } from './dto/create-post-like.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';

@ApiBearerAuth('access-token')
@Controller('post-likes')
export class PostLikesController {
  constructor(private readonly postLikesService: PostLikesService) {}

  @ApiOperation({
    summary: 'Like bài viết',
    description: 'Người dùng đã đăng nhập like một bài viết.',
  })
  @ApiCreatedResponse({
    description: 'Like bài viết thành công',
  })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() createPostLikeDto: CreatePostLikeDto) {
    return this.postLikesService.create(user.sub, createPostLikeDto);
  }

  @ApiOperation({
    summary: 'Danh sách người dùng đã like bài viết',
    description: 'Lấy danh sách user đã like bài viết (có phân trang).',
  })
  @ApiOkResponse({
    description: 'Lấy danh sách user thành công',
  })
  @Get()
  findUsers(
    @Param('postId') postId: string,
    @Query() query: PaginationDto,
  ) {
    return this.postLikesService.findUsers(postId, query);
  }

  @ApiOperation({
    summary: 'Unlike bài viết',
    description: 'Người dùng bỏ like bài viết.',
  })
  @ApiOkResponse({
    description: 'Unlike bài viết thành công',
  })
  @Delete()
  remove(@Param('postId') postId: string, @CurrentUser() user: JwtPayload) {
    return this.postLikesService.remove(user.sub, postId);
  }
}
