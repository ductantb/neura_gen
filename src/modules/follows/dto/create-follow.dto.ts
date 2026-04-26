import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateFollowDto {
  @ApiProperty({
    example: 'user-id-2',
    description: 'ID của người được theo dõi',
  })
  @IsNotEmpty()
  @IsString()
  followingId: string;

  @ApiPropertyOptional({
    example: 'post-id-1',
    description:
      'ID bài viết nguồn nếu follow được thực hiện từ explore. Dùng để ghi nhận tín hiệu FOLLOW_CREATOR.',
  })
  @IsOptional()
  @IsString()
  sourcePostId?: string;
}
