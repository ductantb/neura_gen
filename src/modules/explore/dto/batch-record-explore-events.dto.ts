import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RecordExploreEventDto } from './record-explore-event.dto';

export class BatchRecordExploreEventsDto {
  @ApiProperty({
    type: [RecordExploreEventDto],
    description:
      'Danh sách event từ Explore. Nên gửi theo lô mỗi 2-5 giây để giảm số request.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RecordExploreEventDto)
  events: RecordExploreEventDto[];
}
