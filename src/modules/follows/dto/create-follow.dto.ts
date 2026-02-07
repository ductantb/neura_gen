import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateFollowDto {

  @ApiProperty({
    example: 'user-id-2',
    description: 'ID của người được theo dõi',
  })
  @IsNotEmpty()
  @IsString()
  followingId: string;
}
