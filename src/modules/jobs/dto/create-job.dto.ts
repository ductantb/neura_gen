import { IsOptional, IsString, IsUUID } from "class-validator";

export class CreateVideoJobDto {
  @IsUUID()
  inputAssetId: string;

  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  negativePrompt?: string;
}