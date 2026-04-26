import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreatePostLikeDto {
  @ApiPropertyOptional({
    description:
      'ID của bài viết. Nếu gọi qua route lồng `/posts/:postId/post-likes` thì có thể bỏ qua.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsString()
  postId?: string;
}
