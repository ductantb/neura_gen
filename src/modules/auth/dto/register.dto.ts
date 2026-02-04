import { IsEmail, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @MinLength(8, { message: 'Password tối thiểu 8 ký tự' })
  password: string;
}
