import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { MarkPaymentPaidDto } from './dto/mark-payment-paid.dto';

@ApiTags('billing')
@ApiBearerAuth('access-token')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @ApiOperation({
    summary: 'Lấy catalog giá gói PRO và credit top-up',
  })
  @Get('catalog')
  getCatalog() {
    return this.billingService.getCatalog();
  }

  @ApiOperation({
    summary: 'Tạo đơn thanh toán (MoMo hoặc chuyển khoản)',
  })
  @Post('orders')
  createOrder(@CurrentUser() user: JwtPayload, @Body() dto: CreatePaymentOrderDto) {
    return this.billingService.createOrder(user.sub, dto);
  }

  @ApiOperation({ summary: 'Lấy các đơn thanh toán của tôi' })
  @Get('orders/me')
  listMyOrders(@CurrentUser() user: JwtPayload) {
    return this.billingService.listMyOrders(user.sub);
  }

  @ApiOperation({
    summary:
      'Đánh dấu đơn đã thanh toán (nội bộ/test). Sẽ được thay bằng webhook MoMo/bank ở bước tích hợp gateway.',
  })
  @Roles(UserRole.ADMIN)
  @Post('orders/:id/mark-paid')
  markOrderPaid(@Param('id') id: string, @Body() dto: MarkPaymentPaidDto) {
    return this.billingService.markOrderPaid(id, dto);
  }

  @ApiOperation({
    summary: 'MoMo IPN webhook callback',
    description: 'Endpoint public để MoMo callback kết quả thanh toán.',
  })
  @Public()
  @HttpCode(204)
  @Post('webhooks/momo')
  async momoWebhook(@Body() payload: Record<string, unknown>) {
    await this.billingService.handleMomoIpn(payload);
  }
}
