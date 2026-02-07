import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { CreateGalleryDto } from './dto/create-gallery.dto';
import { UpdateGalleryDto } from './dto/update-gallery.dto';
import { CurrentUser } from 'src/common/decorators/user.decorator';
import { JwtPayload } from 'src/common/guards/jwt-auth.guard';
import { ApiOperation } from '@nestjs/swagger';

@Controller('gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @ApiOperation({ summary: 'Save asset to gallery' })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() createGalleryDto: CreateGalleryDto) {
    return this.galleryService.create(user.sub, createGalleryDto);
  }

  @ApiOperation({ summary: 'Get user gallery' })
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.galleryService.findAll(user.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update gallery visibility' })
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() updateGalleryDto: UpdateGalleryDto) {
    return this.galleryService.update(id, user.sub, updateGalleryDto);
  }

  @ApiOperation({ summary: 'Remove asset from gallery' })
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.galleryService.remove(id, user.sub);
  }
}
