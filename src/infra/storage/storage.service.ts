import { Injectable } from '@nestjs/common';
import { S3Storage } from './s3.storage';
import { SignedUrlResult, UploadInput, UploadResult } from './storage.types';

@Injectable()
export class StorageService {
  constructor(private readonly s3Storage: S3Storage) {}

  upload(input: UploadInput): Promise<UploadResult> {
    return this.s3Storage.upload(input);
  }

  delete(key: string): Promise<void> {
    return this.s3Storage.delete(key);
  }

  getDownloadSignedUrl(key: string, expiresIn?: number): Promise<SignedUrlResult> {
    return this.s3Storage.getDownloadSignedUrl(key, expiresIn);
  }
}