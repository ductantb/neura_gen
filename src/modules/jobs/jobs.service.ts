import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CreateVideoJobDto } from "./dto/create-job.dto";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { JobStatus, JobType } from "@prisma/client";
import { VIDEO_QUEUE } from "src/common/constants";
import { Queue } from "bullmq";
import { AssetRole } from "@prisma/client";

@Injectable()
export class JobsService {

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VIDEO_QUEUE) private readonly videoQueue: Queue,
  ) {}

    async createVideoJob(userId: string, dto: CreateVideoJobDto) {

        // Validate input asset
        const inputAsset = await this.prisma.asset.findUnique({
            where: { id: dto.inputAssetId },
            include: { versions: {
                orderBy: { version: 'desc' },
                take: 1,
            } },
        });
        if (!inputAsset) {
            throw new NotFoundException("Input asset not found");
        }

        if (inputAsset.userId !== userId) {
            throw new BadRequestException("Input asset does not belong to the user");
        }

        if (inputAsset.role !== AssetRole.INPUT) {
            throw new BadRequestException("Asset role must be 'input'");
        }

        if (inputAsset.versions.length === 0) {
            throw new BadRequestException("Input asset has no versions");
        }

        // Create job record in database
        const job = await this.prisma.generateJob.create({
            data: {
                userId,
                type: JobType.IMAGE_TO_VIDEO,
                status: JobStatus.QUEUED,
                AssetId: dto.inputAssetId,
                prompt: dto.prompt,
                negativePrompt: dto.negativePrompt,
            },
        });
        return job;
    }    
}
