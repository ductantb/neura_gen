import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
// import { CreateAssetDto } from './dto/create-asset.dto';
// import { UpdateAssetDto } from './dto/update-asset.dto';
import { StorageService } from '../../infra/storage/storage.service';
import { PrismaClient } from '@prisma/client';
import { AssetRole, AssetType } from '@prisma/client';
import { UploadAssetDto } from './dto/upload-asset.dto';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class AssetsService {

  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  async uploadAsset(
    userId: string,
    file: Express.Multer.File,
    dto: UploadAssetDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required. Send multipart/form-data with field name "file".');
    }

    const assetType = dto.type || this.detectAssetType(file.mimetype);
    const assetRole = dto.role || AssetRole.INPUT;

    const folder = dto.folder || 
                  (dto.jobId ? `jobs/${dto.jobId}/${assetRole.toLowerCase()}`
                              :`users/${userId}/uploads`);
    
    const uploaded = await this.storageService.upload({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
      folder,
      metadata: {
        userId,
        ...(dto.jobId ? { jobId: dto.jobId } : {}),
        assetRole,
        assetType,
      },  
    });

    const asset = await this.prisma.asset.create({
      data: {
        userId,
        jobId: dto.jobId,
        type: assetType,
        role: assetRole,
        originalName: file.originalname,
        mimeType: file.mimetype,
        versions: {
          create: {
            version: 1,
            bucket: uploaded.bucket,
            objectKey: uploaded.key,
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            metadata: {
              uploadedBy: 'api',
              source: 'multipart-upload',
            },
          },
        }
      },
      include: {
        versions: { orderBy: { createdAt: 'desc' }, take: 1 },
      }
    });

    return asset;

  }

  async getAssetById(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        versions: { orderBy: { createdAt: 'desc' } },
        user: { select: { id: true, username: true } },
        job: { select: { id: true, type: true, status: true } },
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset with id ${assetId} not found`);
    }

    return asset;
  }

  async getDownloadSignedUrl(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        versions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset with id ${assetId} not found`);
    }

    const latestVersion = asset.versions[0];

    if (!latestVersion) {
      throw new NotFoundException(`No versions found for asset with id ${assetId}`);
    }

    return this.storageService.getDownloadSignedUrl(latestVersion.objectKey);
  }

  private detectAssetType(mimeType: string): AssetType {
    if (mimeType.startsWith('image/')) {
      return AssetType.IMAGE;
    } else if (mimeType.startsWith('video/')) {
      return AssetType.VIDEO;
    } else if (mimeType.startsWith('audio/')) {
      return AssetType.AUDIO;
    } else {
      throw new Error('Unsupported file type');
    }
  }
}
