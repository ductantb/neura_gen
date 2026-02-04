import { MinLength } from "class-validator";

export class ChangePasswordDto {
  @MinLength(8, { message: 'Password tối thiểu 8 ký tự' })
  password: string;
}