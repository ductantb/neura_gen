import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ExploreQueryDto {
  @ApiPropertyOptional({ example: 'anime' })
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsBooleanString()
  trending?: string;

  @ApiPropertyOptional({
    example: 'trending',
    enum: ['trending', 'new', 'top'],
    description:
      'Chế độ feed. trending: bài đang hot, new: bài mới, top: điểm cao toàn cục',
  })
  @IsOptional()
  @IsIn(['trending', 'new', 'top'])
  mode?: 'trending' | 'new' | 'top';

  @ApiPropertyOptional({ example: 'score' })
  @IsOptional()
  @IsIn(['score', 'newest'])
  sort?: 'score' | 'newest';

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'cursor = ExploreItem.id' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
