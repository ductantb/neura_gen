import { IsNotEmpty, IsString } from "class-validator";

export class CreateFollowDto {
    @IsNotEmpty()
    @IsString()
    followerId: string;
    
    @IsNotEmpty()
    @IsString()
    followingId: string;
}
