import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'Tên người dùng duy nhất, không chứa ký tự đặc biệt',
    example: 'neura_gen_2026',
    minLength: 3,
    maxLength: 30,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MinLength(3)
  username?: string;

  @ApiPropertyOptional({
    description: 'Tiểu sử ngắn gọn về người dùng',
    example: 'Đam mê công nghệ AI và thiết kế chuyển động.',
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  bio?: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn tới ảnh đại diện',
    example: 'https://avatar.com/user123.jpg',
  })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}
