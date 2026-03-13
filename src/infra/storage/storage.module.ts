import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import { S3Storage } from './s3.storage';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [S3Storage, StorageService],
  exports: [StorageService],
})
export class StorageModule {}