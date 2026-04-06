import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class RecordExploreEventDto {
  @ApiProperty({
    example: 'post-id',
    description: 'ID bài viết được tương tác từ trang explore',
  })
  @IsString()
  postId: string;

  @ApiProperty({
    example: 'IMPRESSION',
    enum: [
      'IMPRESSION',
      'OPEN_POST',
      'WATCH_3S',
      'WATCH_50',
      'LIKE',
      'COMMENT',
      'FOLLOW_CREATOR',
      'HIDE',
    ],
  })
  @IsIn([
    'IMPRESSION',
    'OPEN_POST',
    'WATCH_3S',
    'WATCH_50',
    'LIKE',
    'COMMENT',
    'FOLLOW_CREATOR',
    'HIDE',
  ])
  eventType:
    | 'IMPRESSION'
    | 'OPEN_POST'
    | 'WATCH_3S'
    | 'WATCH_50'
    | 'LIKE'
    | 'COMMENT'
    | 'FOLLOW_CREATOR'
    | 'HIDE';

  @ApiPropertyOptional({
    example: '{"surface":"explore_grid"}',
    description: 'Metadata tùy chọn từ frontend',
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
