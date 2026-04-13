import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkPaymentPaidDto {
  @ApiPropertyOptional({
    description: 'Mã giao dịch từ cổng thanh toán hoặc ngân hàng.',
    example: 'MOMO_20260410_ABC123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerOrderId?: string;
}
