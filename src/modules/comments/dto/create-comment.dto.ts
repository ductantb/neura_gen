import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class CreateCommentDto {

  @ApiProperty({
    description: 'Id của bài viết',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  postId: string;

  @ApiProperty({
    description: 'Nội dung bình luận',
    example: 'This is a comment.',
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  content: string;
}
