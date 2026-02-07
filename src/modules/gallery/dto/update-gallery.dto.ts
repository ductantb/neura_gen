import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateGalleryDto {
  @ApiProperty({
    description: 'Gallery item có được public hay không',
    example: true,
  })
  @IsBoolean()
  isPublic: boolean;
}
