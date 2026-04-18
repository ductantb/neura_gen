import {
  Controller,
  Post,
  Body,
  Patch,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  ChangePasswordResponseDto,
} from './dto/change-password.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import {
  ForgotPasswordDto,
  ForgotPasswordResponseDto,
} from './dto/forgot-password.dto';
import {
  ResetPasswordDto,
  ResetPasswordResponseDto,
} from './dto/reset-password.dto';

import { Public } from 'src/common/decorators/public.decorator';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import type { Request } from 'express';
import { GoogleProfilePayload } from './strategies/google.strategy';
import { GoogleOauthGuard } from './guards/google-oauth.guard';

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

  @ApiOperation({
    summary: 'Đăng nhập nhanh bằng Google OAuth2',
    description: 'Chuyển hướng người dùng sang Google để xác thực.',
  })
  @Public()
  @Get('google')
  @UseGuards(GoogleOauthGuard)
  googleAuth() {
    return;
  }

  @ApiOperation({
    summary: 'Google OAuth2 callback',
    description: 'Google redirect về endpoint này, hệ thống trả JWT/refresh token.',
  })
  @Public()
  @Get('google/callback')
  @UseGuards(GoogleOauthGuard)
  googleAuthCallback(@Req() req: Request) {
    return this.authService.loginWithGoogle(req.user as GoogleProfilePayload);
  }

  @ApiOperation({
    summary: 'Làm mới access token',
    description: 'Dùng refresh token để cấp cặp token mới.',
  })
  @ApiOkResponse({
    description: 'Refresh token thành công',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token không hợp lệ hoặc đã hết hạn',
  })
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Logout thiết bị hiện tại',
    description: 'Revoke refresh session của thiết bị hiện tại.',
  })
  @ApiOkResponse({
    description: 'Logout thành công',
    schema: {
      example: {
        message: 'Logged out successfully',
      },
    },
  })
  @Post('logout')
  logout(@CurrentUser() user: JwtPayload, @Body() dto: LogoutDto) {
    return this.authService.logout(user.sub, dto.refreshToken);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Logout tất cả thiết bị',
    description: 'Revoke toàn bộ refresh sessions của người dùng.',
  })
  @ApiOkResponse({
    description: 'Logout tất cả thiết bị thành công',
    schema: {
      example: {
        message: 'Logged out from all devices successfully',
      },
    },
  })
  @Post('logout-all')
  logoutAll(@CurrentUser() user: JwtPayload) {
    return this.authService.logoutAll(user.sub);
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

  @ApiOperation({
    summary: 'Quên mật khẩu',
    description: 'Gửi email chứa link reset mật khẩu qua Gmail SMTP.',
  })
  @ApiOkResponse({
    description: 'Yêu cầu reset mật khẩu đã được tiếp nhận',
    type: ForgotPasswordResponseDto,
  })
  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @ApiOperation({
    summary: 'Đặt lại mật khẩu',
    description: 'Đặt mật khẩu mới bằng reset token nhận từ email.',
  })
  @ApiOkResponse({
    description: 'Đặt lại mật khẩu thành công',
    type: ResetPasswordResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Token không hợp lệ hoặc đã hết hạn',
  })
  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }
}
