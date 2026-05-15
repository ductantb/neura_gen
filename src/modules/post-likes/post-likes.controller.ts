import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { PostLikesService } from './post-likes.service';
import { CreatePostLikeDto } from './dto/create-post-like.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';

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
  create(
    @Param('postId') postId: string,
    @CurrentUser() user: JwtPayload,
    @Body() createPostLikeDto: CreatePostLikeDto,
  ) {
    return this.postLikesService.create(user.sub, {
      ...createPostLikeDto,
      postId: this.resolvePostId(postId, createPostLikeDto.postId),
    });
  }

  @ApiOperation({
    summary: 'Danh sách người dùng đã like bài viết',
    description: 'Lấy danh sách user đã like bài viết (có phân trang).',
  })
  @ApiOkResponse({
    description: 'Lấy danh sách user thành công',
  })
  @ApiQuery({ name: 'cursor', required: false, example: 1 })
  @ApiQuery({ name: 'take', required: false, example: 10 })
  @Get()
  findUsers(@Param('postId') postId: string, @Query() query: PaginationDto) {
    return this.postLikesService.findUsers(postId, query);
  }

  @ApiOperation({
    summary: 'Unlike bài viết',
    description: 'Người dùng bỏ like bài viết.',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    description:
      'Chỉ ADMIN: userId chủ like cần xoá. Bỏ trống thì xoá like của chính tài khoản hiện tại.',
  })
  @ApiOkResponse({
    description: 'Unlike bài viết thành công',
  })
  @Delete()
  remove(
    @Param('postId') postId: string,
    @CurrentUser() user: JwtPayload,
    @Query('userId') targetUserId?: string,
  ) {
    return this.postLikesService.removeWithTarget(
      postId,
      {
        sub: user.sub,
        role: user.role,
      },
      targetUserId,
    );
  }

  private resolvePostId(routePostId: string, bodyPostId?: string) {
    const normalizedBodyPostId = bodyPostId?.trim();
    if (normalizedBodyPostId && normalizedBodyPostId !== routePostId) {
      throw new BadRequestException(
        'postId trong body không khớp với postId trên URL',
      );
    }

    return routePostId;
  }
}
