import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';

export class ExploreQueryDto {
  @ApiPropertyOptional({ example: 'anime' })
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsBooleanString()
  trending?: string;

  @ApiPropertyOptional({ example: 'score' })
  @IsOptional()
  @IsIn(['score', 'newest'])
  sort?: 'score' | 'newest';

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'cursor = ExploreItem.id' })
  @IsOptional()
  cursor?: string;
}
