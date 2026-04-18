import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ExploreService } from './explore.service';
import { ExploreQueryDto } from './dto/explore-query.dto';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { RecordExploreEventDto } from './dto/record-explore-event.dto';
import { BatchRecordExploreEventsDto } from './dto/batch-record-explore-events.dto';

@Controller('explore')
export class ExploreController {
  constructor(private readonly exploreService: ExploreService) {}

  @ApiOperation({
    summary: 'Explore public images & videos',
    description:
      'Danh sách ảnh/video public, hỗ trợ trending, topic, sort và cursor pagination',
  })
  @Public()
  @Get()
  async getExplore(@Query() query: ExploreQueryDto) {
    return this.exploreService.getExplore(query);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Personalized explore feed',
    description:
      'Feed cá nhân hóa theo hành vi user, vẫn giữ trộn nội dung trending/new để tránh echo chamber',
  })
  @Get('for-you')
  async getForYou(
    @CurrentUser() user: JwtPayload,
    @Query() query: ExploreQueryDto,
  ) {
    return this.exploreService.getForYou(user.sub, query);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Record explore behavior event',
    description:
      'Ghi nhận hành vi user trên trang explore để cập nhật hồ sơ sở thích và tối ưu feed for_you',
  })
  @Post('events')
  async recordEvent(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordExploreEventDto,
  ) {
    return this.exploreService.recordEvent(user.sub, dto);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Record explore behavior events in batch',
    description:
      'Ghi nhận event theo lô (thường dùng cho impression mỗi 2-5 giây) để giảm số request từ frontend',
  })
  @Post('events/batch')
  async recordEventsBatch(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BatchRecordExploreEventsDto,
  ) {
    return this.exploreService.recordEventsBatch(user.sub, dto);
  }
}
