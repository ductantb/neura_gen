import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePostDto {
    @IsNotEmpty()
    @IsString()
    userId: string;

    @IsNotEmpty()
    @IsString()
    assetVersionId: string;

    @IsOptional()
    @IsString()
    caption?: string;

    @IsBoolean()
    isPublic: boolean;

    @IsInt()
    likeCount: number;

    @IsInt()
    commentCount: number;

    @IsInt()
    viewCount: number;
}
