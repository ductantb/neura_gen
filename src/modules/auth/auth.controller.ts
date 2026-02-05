import { Controller, Post, Body, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  ChangePasswordResponseDto,
} from './dto/change-password.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

import { Public } from 'src/common/decorators/public.decorator';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: 'Đăng ký tài khoản mới',
    description: 'Tạo tài khoản người dùng mới trong hệ thống.',
  })
  @ApiCreatedResponse({
    description: 'Đăng ký thành công',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Email đã tồn tại hoặc dữ liệu không hợp lệ',
  })
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password);
  }

  @ApiOperation({
    summary: 'Đăng nhập',
    description: 'Xác thực người dùng bằng email và mật khẩu.',
  })
  @ApiOkResponse({
    description: 'Đăng nhập thành công',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Email hoặc mật khẩu không đúng',
  })
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Đổi mật khẩu',
    description: 'Cho phép người dùng đã đăng nhập thay đổi mật khẩu.',
  })
  @ApiOkResponse({
    description: 'Đổi mật khẩu thành công',
    type: ChangePasswordResponseDto,
  })
  @Patch('change-password')
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.sub,
      dto.oldPassword,
      dto.newPassword,
    );
  }
}
