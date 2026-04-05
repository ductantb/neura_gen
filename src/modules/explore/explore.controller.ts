import { Controller, Get, Query } from '@nestjs/common';
import { ExploreService } from './explore.service';
import { ExploreQueryDto } from './dto/explore-query.dto';
import { ApiOperation } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';

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
}
