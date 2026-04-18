import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Reset token nhận qua email',
    required: true,
  })
  @IsString()
  token: string;

  @ApiProperty({
    description: 'Mật khẩu mới',
    example: 'newPassword123',
    required: true,
  })
  @IsString()
  @MinLength(8, { message: 'Password tối thiểu 8 ký tự' })
  newPassword: string;
}

export class ResetPasswordResponseDto {
  @ApiProperty({
    description: 'Thông báo thành công',
    example: 'Password reset successfully',
  })
  message: string;
}
