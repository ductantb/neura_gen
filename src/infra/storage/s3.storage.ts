import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  IStorageProvider,
  SignedUrlResult,
  UploadInput,
  UploadResult,
} from './storage.types';

@Injectable()
export class S3Storage implements IStorageProvider {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const bucket = this.configService.get<string>('AWS_S3_BUCKET');
    const keyPrefix = this.configService.get<string>('S3_KEY_PREFIX') || 'neuragen';

    if (!accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('Missing S3 environment variables');
    }

    this.bucket = bucket;
    this.keyPrefix = keyPrefix;

    this.s3 = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  private buildKey(originalName: string, folder = 'misc'): string {
    const ext = path.extname(originalName || '');
    const safeFolder = folder.replace(/^\/+|\/+$/g, '');
    return `${this.keyPrefix}/${safeFolder}/${Date.now()}-${randomUUID()}${ext}`;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const key = this.buildKey(input.originalName, input.folder);

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: input.buffer,
          ContentType: input.mimeType,
          Metadata: input.metadata,
        }),
      );

      return {
        bucket: this.bucket,
        key,
        mimeType: input.mimeType,
        size: input.buffer.length,
        originalName: input.originalName,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      throw new InternalServerErrorException(
        `S3 delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async getDownloadSignedUrl(
    key: string,
    expiresIn = 3600,
  ): Promise<SignedUrlResult> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const url = await getSignedUrl(this.s3, command, { expiresIn });

      return { url, expiresIn };
    } catch (error) {
      throw new InternalServerErrorException(
        `Generate signed URL failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}