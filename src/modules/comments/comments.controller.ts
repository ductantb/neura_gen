import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiBearerAuth('access-token')
@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @ApiOperation({
    summary: 'Tạo comment',
    description: 'Tạo comment mới cho một bài viết.',
  })
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('postId') postId: string,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.commentsService.create(user.sub, postId, createCommentDto);
  }

  @ApiOperation({
    summary: 'Danh sách comment của bài viết',
    description: 'Lấy danh sách comment của một bài viết (có phân trang).',
  })
  @ApiQuery({ name: 'cursor', required: false, example: 1 })
  @ApiQuery({ name: 'take', required: false, example: 10 })
  @Get()
  findComments(@Param('postId') postId: string, @Query() query: PaginationDto) {
    return this.commentsService.findComments(postId, query);
  }

  @ApiOperation({
    summary: 'Cập nhật comment',
    description: 'Chỉ chủ comment mới được phép cập nhật.',
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() updateCommentDto: UpdateCommentDto,
  ) {
    return this.commentsService.update(
      id,
      { sub: user.sub, role: user.role },
      updateCommentDto,
    );
  }

  @ApiOperation({
    summary: 'Xoá comment',
    description: 'Chỉ chủ comment mới được phép xoá.',
  })
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.commentsService.remove(id, { sub: user.sub, role: user.role });
  }
}
