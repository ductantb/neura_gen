import { Controller, Get, Post, Body, Patch, Param, Delete, BadRequestException, Req } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../../infra/storage/storage.service';
import { UploadAssetDto } from './dto/upload-asset.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAsset(
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAssetDto,
  ) {

    // log test bug
    console.log(req.headers.authorization);
    console.log('USER:', req.user);

    const userId = req.user?.sub; // Assuming you have authentication and user info in the request
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    return this.assetsService.uploadAsset(userId, file, dto);
  }

  @Get(':id')
  async getAsset(@Param('id') id: string) {
    return this.assetsService.getAssetById(id);
  }

  @Get('download/:id')
  async getDownloadSignedUrl(@Param('id') id: string) {
    return this.assetsService.getDownloadSignedUrl(id);
  }

}