import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { MyProfileResponseDto } from './dto/my-profile-response.dto';

@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Cập nhật thông tin cá nhân' })
  @ApiOkResponse({ description: 'Cập nhật thành công' })
  @Patch('me')
  update(@CurrentUser() user, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.sub, dto);
  }

  @ApiOperation({ summary: 'Lấy thông tin tài khoản hiện tại' })
  @ApiOkResponse({
    description: 'Lấy thông tin thành công',
    type: MyProfileResponseDto,
  })
  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getProfile(user.sub);
  }

  @ApiOperation({ summary: 'Lấy thông tin người dùng theo ID' })
  @ApiNotFoundResponse({ description: 'Không tìm thấy người dùng' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({ summary: 'Xóa tài khoản của tôi' })
  @ApiOkResponse({ description: 'Xóa thành công' })
  @Delete('me')
  remove(@CurrentUser() user: JwtPayload) {
    return this.usersService.remove(user.sub);
  }
}
