import { Test, TestingModule } from '@nestjs/testing';
import { ModalService } from './modal.service';

describe('ModalService', () => {
  let service: ModalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ModalService],
    }).compile();

    service = module.get<ModalService>(ModalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
