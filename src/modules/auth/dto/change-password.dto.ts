import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Mật khẩu cũ của người dùng',
    example: '12345678',
    required: true,
  })
  @IsString()
  oldPassword: string;

  @ApiProperty({
    description: 'Mật khẩu mới của người dùng',
    example: '87654321',
    required: true,
  })
  @IsString()
  @MinLength(8, { message: 'Password tối thiểu 8 ký tự' })
  newPassword: string;
}

export class ChangePasswordResponseDto {
  @ApiProperty({
    description: 'Thông báo thành công',
    example: 'Đổi mật khẩu thành công',
    required: true,
  })
  message: string;
}
