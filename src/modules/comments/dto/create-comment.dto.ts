import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class CreateCommentDto {
  @ApiProperty({
    description: 'Nội dung bình luận',
    example: 'This is a comment.',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  content: string;
}
