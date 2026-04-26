import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCommentDto {
  @ApiPropertyOptional({
    description:
      'Id của bài viết. Nếu gọi qua route lồng `/posts/:postId/comments` thì có thể bỏ qua.',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  postId?: string;

  @ApiProperty({
    description: 'Nội dung bình luận',
    example: 'This is a comment.',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  content: string;
}
