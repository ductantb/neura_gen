import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email cần reset mật khẩu',
    example: 'test@example.com',
    required: true,
  })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;
}

export class ForgotPasswordResponseDto {
  @ApiProperty({
    description: 'Thông báo kết quả',
    example:
      'If this email exists in our system, a password reset link has been sent.',
  })
  message: string;
}
