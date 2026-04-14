import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

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
  @Type(() => Number)
  @IsNumber()
  limit?: number;

  @ApiPropertyOptional({ description: 'cursor = ExploreItem.id' })
  @IsOptional()
  cursor?: string;
}
