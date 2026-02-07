import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePostDto {

  @ApiProperty({
    description: 'ID phiên bản asset (ảnh hoặc video) liên kết với bài viết',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsNotEmpty()
  @IsString()
  assetVersionId: string;

  @ApiPropertyOptional({
    description: 'Nội dung mô tả bài viết',
    example: 'Hôm nay trời đẹp quá 🌤️',
  })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiProperty({
    description: 'Bài viết có được công khai hay không',
    example: true,
  })
  @IsBoolean()
  isPublic: boolean;
}
