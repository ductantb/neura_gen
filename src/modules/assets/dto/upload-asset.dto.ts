import {AssetRole, AssetType, StorageProvider} from '@prisma/client';
import {PrismaClient} from '@prisma/client';
import {IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID} from 'class-validator';

export class UploadAssetDto {
  @IsOptional()
  @IsUUID()
  jobId: string;

  @IsOptional()
  @IsEnum(AssetType)
  type: AssetType;

  @IsOptional()
  @IsEnum(AssetRole)
  role: AssetRole;

  @IsOptional()
  @IsString()
  folder: string;
}
