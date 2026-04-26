import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateVideoJobDto {
  @IsOptional()
  @IsUUID()
  inputAssetId?: string;

  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @IsOptional()
  @IsString()
  presetId?: string;

  @IsOptional()
  @IsBoolean()
  includeBackgroundAudio?: boolean;
}
