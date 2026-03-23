import { Controller, Get, Post, Body } from '@nestjs/common';
import { ModalService } from './modal.service';
import type { GenerateVideoInput } from './modal.service';

@Controller('modal')
export class ModalController {
  constructor(private readonly modal: ModalService) {}

  @Post('generate-video')
  async generateVideo(@Body() body: GenerateVideoInput) {
    return this.modal.generateVideo(body);
  }

  // @Get('smoke')
  // async smoke() {
  //   return this.modal.smokeTest();
  // }
}
