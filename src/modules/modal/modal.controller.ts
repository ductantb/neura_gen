import { Controller, Get } from '@nestjs/common';
import { ModalService } from './modal.service';

@Controller('modal')
export class ModalController {
  constructor(private readonly modal: ModalService) {}

  @Get('smoke')
  async smoke() {
    return this.modal.smokeTest();
  }
}
