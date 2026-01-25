import { Test, TestingModule } from '@nestjs/testing';
import { ModalController } from './modal.controller';

describe('ModalController', () => {
  let controller: ModalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModalController],
    }).compile();

    controller = module.get<ModalController>(ModalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
