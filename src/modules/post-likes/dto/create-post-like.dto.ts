import { IsNotEmpty, IsString } from "class-validator";

export class CreatePostLikeDto {
    @IsNotEmpty()
    @IsString()
    postId: string;

    @IsNotEmpty()
    @IsString()
    userId: string;
}
