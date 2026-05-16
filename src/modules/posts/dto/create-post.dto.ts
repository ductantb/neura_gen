import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

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

  @ApiPropertyOptional({
    description:
      'Topic của bài viết để tối ưu Explore/Search. Chỉ cho phép chữ thường, số, dấu gạch nối hoặc gạch dưới.',
    example: 'cinematic',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'topic can only contain letters, numbers, "_" or "-"',
  })
  topic?: string;

  @ApiPropertyOptional({
    description:
      'URL video client đang giữ để tiện đồng bộ payload. Backend không lưu field này, response sẽ tự suy ra lại từ assetVersion.',
    example: 'https://cdn.example/video.mp4',
  })
  @IsOptional()
  @IsString()
  videoUrl?: string;

  @ApiPropertyOptional({
    description:
      'URL thumbnail client đang giữ để tiện đồng bộ payload. Backend không lưu field này, response sẽ tự suy ra lại từ assetVersion/job thumbnail.',
    example: 'https://cdn.example/thumb.jpg',
  })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({
    description: 'Bài viết có được công khai hay không',
    example: true,
  })
  @IsBoolean()
  isPublic: boolean;
}
