import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email của người dùng',
    example: 'test@example.com',
    required: true,
  })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @ApiProperty({
    description: 'Mật khẩu của người dùng',
    example: '12345678',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  password: string;
}
