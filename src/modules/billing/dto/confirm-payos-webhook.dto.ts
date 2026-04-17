import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUrl } from 'class-validator';

export class ConfirmPayosWebhookDto {
  @ApiPropertyOptional({
    description:
      'Webhook URL public muốn đăng ký với payOS. Nếu bỏ trống sẽ dùng PAYOS_WEBHOOK_URL trong env.',
    example: 'https://api.example.com/billing/webhooks/payos',
  })
  @IsOptional()
  @IsUrl({
    require_tld: true,
  })
  webhookUrl?: string;
}
