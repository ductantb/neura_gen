import {
  Controller,
  Get,
  Body,
  Patch,
  Post,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { MyProfileResponseDto } from './dto/my-profile-response.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import {
  TopUpCreditDto,
  TopUpCreditResponseDto,
} from './dto/top-up-credit.dto';

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
  @ApiQuery({ name: 'cursor', required: false, example: 'job-id-cursor' })
  @ApiQuery({ name: 'take', required: false, example: 10 })
  @ApiOkResponse({
    description: 'Lấy thông tin thành công',
    type: MyProfileResponseDto,
  })
  @Get('me')
  getMe(@CurrentUser() user: JwtPayload, @Query() query: PaginationDto) {
    return this.usersService.getProfile(user.sub, query);
  }

  @ApiOperation({
    summary: 'Cộng credit test cho tài khoản hiện tại',
    description:
      'API tạm thời để test luồng credit trước khi tích hợp ngân hàng hoặc cổng thanh toán.',
  })
  @ApiOkResponse({
    description: 'Cộng credit thành công',
    type: TopUpCreditResponseDto,
  })
  @Post('me/credits/topup')
  topUpMyCredits(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TopUpCreditDto,
  ) {
    return this.usersService.topUpMyCredits(user.sub, dto);
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
