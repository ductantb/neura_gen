import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, MinLength } from "class-validator";

export class RegisterDto {
  @ApiProperty({ 
    description: 'Email của người dùng',
    example: 'test@example.com',
    required: true
  })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @ApiProperty({ 
    description: 'Mật khẩu của người dùng',
    example: '12345678',
    required: true
  })
  @MinLength(8, { message: 'Password tối thiểu 8 ký tự' })
  password: string;
}
