import { PaymentOrderType, PaymentProvider } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreatePaymentOrderDto {
  @ApiProperty({
    enum: PaymentOrderType,
    example: PaymentOrderType.CREDIT_TOPUP,
  })
  @IsEnum(PaymentOrderType)
  type: PaymentOrderType;

  @ApiProperty({
    enum: PaymentProvider,
    example: PaymentProvider.PAYOS,
  })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  @ApiPropertyOptional({
    description:
      'Mã package billing. Nếu bỏ trống sẽ dùng mặc định theo loại đơn.',
    example: 'TOPUP_POPULAR_9_99',
  })
  @IsOptional()
  @IsString()
  packageCode?: string;
}
