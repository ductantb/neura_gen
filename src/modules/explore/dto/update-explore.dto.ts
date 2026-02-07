import { PartialType } from '@nestjs/swagger';
import { CreateExploreDto } from './create-explore.dto';

export class UpdateExploreDto extends PartialType(CreateExploreDto) {}
