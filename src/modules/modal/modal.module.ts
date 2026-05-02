import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ModalService } from './modal.service';
import { ModalController } from './modal.controller';
import { VastService } from './vast.service';

@Module({
  imports: [HttpModule],
  providers: [ModalService, VastService],
  controllers: [ModalController],
  exports: [ModalService, VastService],
})
export class ModalModule {}
