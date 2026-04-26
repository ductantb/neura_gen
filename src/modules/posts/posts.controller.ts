import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import type { Request } from 'express';
import { Public } from 'src/common/decorators/public.decorator';

@ApiBearerAuth('access-token')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @ApiOperation({
    summary: 'Tạo bài viết mới',
    description: 'Tạo bài viết mới cho người dùng đã đăng nhập.',
  })
  @ApiCreatedResponse({
    description: 'Tạo bài viết thành công',
  })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() createPostDto: CreatePostDto,
  ) {
    return this.postsService.create(user.sub, createPostDto);
  }

  @Get()
  @Public()
  findAll() {
    return this.postsService.findAll();
  }

  @ApiOperation({
    summary: 'Lấy chi tiết bài viết',
    description: 'Lấy thông tin chi tiết của một bài viết theo ID.',
  })
  @ApiOkResponse({
    description: 'Lấy bài viết thành công',
  })
  @Get(':id')
  @Public()
  async findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    // Xử lý x-forwarded-for để lấy IP đầu tiên trong danh sách
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]
        : req.ip || req.socket.remoteAddress;

    const userAgent = req.headers['user-agent'] || '';

    if (!rawIp) {
      return this.postsService.findOne(id);
    }

    const user = (req as Request & { user?: JwtPayload }).user;

    await this.postsService.trackView(id, rawIp, userAgent, user?.sub);

    return this.postsService.findOne(id);
  }

  @ApiOperation({
    summary: 'Cập nhật bài viết',
    description: 'Chỉ chủ bài viết mới được phép cập nhật.',
  })
  @ApiOkResponse({
    description: 'Cập nhật bài viết thành công',
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    return this.postsService.update(
      id,
      { sub: user.sub, role: user.role },
      updatePostDto,
    );
  }

  @ApiOperation({
    summary: 'Xoá bài viết',
    description: 'Xoá bài viết theo ID.',
  })
  @ApiOkResponse({
    description: 'Xoá bài viết thành công',
  })
  @ApiNotFoundResponse({
    description: 'Không tìm thấy bài viết',
  })
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.postsService.remove(id, { sub: user.sub, role: user.role });
  }
}
