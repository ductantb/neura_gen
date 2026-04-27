import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchExploreByTopicDto {
  @ApiProperty({
    example: 'anime',
    description: 'Chủ đề cần tìm trên explore. So khớp theo topic đã được chuẩn hóa trong ExploreItem.',
  })
  @IsString()
  @IsNotEmpty()
  topic: string;

  @ApiPropertyOptional({ example: 'score' })
  @IsOptional()
  @IsIn(['score', 'newest'])
  sort?: 'score' | 'newest';

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsIn(['true', 'false'])
  trending?: 'true' | 'false';

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
