import { CreditReason } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class TopUpCreditDto {
  @ApiProperty({
    description: 'Số credit muốn cộng thêm để test',
    example: 50,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({
    description: 'Ghi chú nội bộ cho lần cộng credit test',
    example: 'Top up thủ công để test flow tạo video',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MaxLength(255)
  note?: string;
}

export class TopUpCreditResponseDto {
  @ApiProperty({
    description: 'ID của người dùng vừa được cộng credit',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  userId: string;

  @ApiProperty({
    description: 'Số credit vừa được cộng thêm',
    example: 50,
  })
  amount: number;

  @ApiProperty({
    description: 'Số dư credit mới sau khi cộng',
    example: 150,
  })
  balance: number;

  @ApiProperty({
    description: 'Lý do ghi nhận transaction',
    enum: CreditReason,
    example: CreditReason.TEST_REWARD,
  })
  reason: CreditReason;

  @ApiProperty({
    description: 'ID của transaction credit vừa tạo',
    example: '34f78d75-7a3b-4d74-a5b4-48f7304e88ad',
  })
  transactionId: string;

  @ApiPropertyOptional({
    description: 'Ghi chú đi kèm transaction',
    example: 'Top up thủ công để test flow tạo video',
    nullable: true,
  })
  note?: string | null;

  @ApiProperty({
    description: 'Thời điểm transaction được tạo',
    example: '2026-03-31T03:45:00.000Z',
  })
  createdAt: Date;
}
