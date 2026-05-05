import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class GoogleTokenLoginDto {
  @ApiProperty({
    description: 'Google ID token nhận từ Android/Web SDK',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...'
  })
  @IsString()
  @MinLength(20)
  idToken: string;

  @ApiPropertyOptional({
    description: 'Nền tảng gửi token: web hoặc android',
    example: 'android',
  })
  @IsOptional()
  @IsString()
  platform?: string;
}

export class GoogleExchangeCodeDto {
  @ApiProperty({
    description: 'Mã đăng nhập one-time trả về từ callback OAuth',
    example: '6f8b8f4e43f0475a873e6f8944d30786',
  })
  @IsString()
  @MinLength(12)
  code: string;
}

export class GoogleOauthCallbackResponseDto {
  @ApiProperty({
    description: 'Trạng thái callback',
    example: 'ok',
  })
  @IsString()
  status: string;

  @ApiProperty({
    description: 'Mã one-time để frontend đổi lấy access/refresh token',
    example: '6f8b8f4e43f0475a873e6f8944d30786',
  })
  @IsString()
  code: string;
}
