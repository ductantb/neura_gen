import {
  Controller,
  Post,
  Body,
  Patch,
  Get,
  Req,
  Res,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
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
import type { Response } from 'express';
import { GoogleProfilePayload } from './strategies/google.strategy';
import { GoogleOauthGuard } from './guards/google-oauth.guard';
import {
  GoogleExchangeCodeDto,
  GoogleOauthCallbackResponseDto,
  GoogleTokenLoginDto,
} from './dto/google-login.dto';
import { Throttle } from '@nestjs/throttler';

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
  @Throttle({ default: { limit: 5, ttl: 5 * 60_000 } })
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
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @ApiOperation({
    summary: 'Đăng nhập nhanh bằng Google OAuth2',
    description:
      'Chuyển hướng người dùng sang Google để xác thực. Nếu chưa có tài khoản sẽ tự động đăng ký và đăng nhập. Có thể truyền redirectUri/platform qua query.',
  })
  @Public()
  @Get('google/login')
  @UseGuards(GoogleOauthGuard)
  googleAuth(
    @Query('redirectUri') _redirectUri?: string,
    @Query('platform') _platform?: string,
  ) {
    return;
  }

  @ApiOperation({
    summary: 'Alias cũ cho đăng nhập Google OAuth2',
    description:
      'Tương thích ngược với frontend cũ. Nên dùng /auth/google/login thay cho endpoint này.',
  })
  @Public()
  @Get('google')
  @UseGuards(GoogleOauthGuard)
  googleAuthLegacy(
    @Query('redirectUri') _redirectUri?: string,
    @Query('platform') _platform?: string,
  ) {
    return;
  }

  @ApiOperation({
    summary: 'Đăng ký nhanh bằng Google OAuth2',
    description:
      'Chuyển hướng người dùng sang Google để đăng ký. Nếu email đã tồn tại sẽ trả lỗi.',
  })
  @Public()
  @Get('google/register')
  @UseGuards(GoogleOauthGuard)
  googleRegister(
    @Query('redirectUri') _redirectUri?: string,
    @Query('platform') _platform?: string,
  ) {
    return;
  }

  @ApiOperation({
    summary: 'Google OAuth2 callback',
    description:
      'Google redirect về endpoint này. Nếu state có redirectUri hợp lệ, backend redirect kèm auth code one-time.',
  })
  @ApiOkResponse({
    type: GoogleOauthCallbackResponseDto,
    description:
      'Callback thành công. Trả JSON nếu không dùng redirectUri, hoặc redirect về frontend nếu có.',
  })
  @Public()
  @Get('google/callback')
  @UseGuards(GoogleOauthGuard)
  async googleAuthCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('state') state?: string,
  ) {
    const oauthState = await this.authService.consumeGoogleOauthState(state);
    const profile = req.user as GoogleProfilePayload;
    const authResponse =
      oauthState.intent === 'register'
        ? await this.authService.registerWithGoogle(profile)
        : await this.authService.loginWithGoogle(profile);
    const code = await this.authService.createGoogleAuthCode(authResponse);

    if (oauthState.redirectUri) {
      const separator = oauthState.redirectUri.includes('?') ? '&' : '?';
      const redirectUrl = `${oauthState.redirectUri}${separator}code=${encodeURIComponent(code)}`;
      return res.redirect(302, redirectUrl);
    }

    return res.json({
      status: 'ok',
      code,
    });
  }

  @ApiOperation({
    summary: 'Đăng nhập Google bằng ID token (Android/Web SDK)',
    description:
      'Nhận idToken từ Google SDK và trả accessToken/refreshToken của hệ thống. Nếu chưa có tài khoản sẽ tự động đăng ký và đăng nhập.',
  })
  @ApiBody({ type: GoogleTokenLoginDto })
  @ApiOkResponse({
    type: AuthResponseDto,
  })
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('google/token')
  googleTokenLogin(@Body() dto: GoogleTokenLoginDto) {
    return this.authService.loginWithGoogleIdToken(dto.idToken, dto.platform);
  }

  @ApiOperation({
    summary: 'Đăng ký Google bằng ID token (Android/Web SDK)',
    description:
      'Nhận idToken từ Google SDK để đăng ký. Nếu email đã tồn tại sẽ trả lỗi.',
  })
  @ApiBody({ type: GoogleTokenLoginDto })
  @ApiOkResponse({
    type: AuthResponseDto,
  })
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('google/token/register')
  googleTokenRegister(@Body() dto: GoogleTokenLoginDto) {
    return this.authService.registerWithGoogleIdToken(dto.idToken, dto.platform);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Liên kết tài khoản Google cho user hiện tại',
    description:
      'User đã đăng nhập cung cấp Google ID token để liên kết. Không tự động link trong luồng đăng nhập.',
  })
  @ApiBody({ type: GoogleTokenLoginDto })
  @ApiOkResponse({
    schema: {
      example: {
        message: 'Google account linked successfully',
      },
    },
  })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('google/link')
  googleLink(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GoogleTokenLoginDto,
  ) {
    return this.authService.linkGoogleAccountByIdToken(
      user.sub,
      dto.idToken,
      dto.platform,
    );
  }

  @ApiOperation({
    summary: 'Đổi auth code Google sang token hệ thống',
    description:
      'Frontend web gọi endpoint này sau khi nhận code one-time từ redirect callback.',
  })
  @ApiBody({ type: GoogleExchangeCodeDto })
  @ApiOkResponse({
    type: AuthResponseDto,
  })
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('google/exchange-code')
  googleExchangeCode(@Body() dto: GoogleExchangeCodeDto) {
    return this.authService.exchangeGoogleAuthCode(dto.code);
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
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
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
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }
}
