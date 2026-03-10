import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ModalService } from './modal.service';
import { ModalController } from './modal.controller';

@Module({
  imports: [HttpModule],
  providers: [ModalService],
  controllers: [ModalController],
  exports: [ModalService],
})
export class ModalModule {}
