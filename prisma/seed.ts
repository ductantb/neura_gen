import {
  PrismaClient,
  UserRole,
  JobType,
  JobStatus,
  AssetType,
  AssetRole,
  StorageProvider,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Seed keys để chạy nhiều lần không trùng logic
const SEED = {
  userEmail: 'test@gmail.com',
  userPassword: '12345678',
  username: 'testuser',

  jobSeedKey: 'seed:v2:job:image_to_video:cyberpunk_city',
  inputAssetSeedKey: 'seed:v2:asset:input:image',
  outputAssetSeedKey: 'seed:v2:asset:output:video',
};

async function main() {
  console.log('🌱 Seeding database (idempotent)...');

  const passwordHash = await bcrypt.hash(SEED.userPassword, 10);

  // 1) User
  const user = await prisma.user.upsert({
    where: { email: SEED.userEmail },
    update: {},
    create: {
      email: SEED.userEmail,
      password: passwordHash,
      username: SEED.username,
      role: UserRole.FREE,
    },
  });

  console.log('✅ User ready:', user.email);
  console.log('👉 USER ID:', user.id);

  // 2) UserCredit
  await prisma.userCredit.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      balance: 100,
    },
  });

  console.log('✅ UserCredit ready');

  // 3) GenerateJob
  let job = await prisma.generateJob.findFirst({
    where: {
      userId: user.id,
      extraConfig: {
        path: ['seedKey'],
        equals: SEED.jobSeedKey,
      },
    },
  });

  if (!job) {
    job = await prisma.generateJob.create({
      data: {
        userId: user.id,
        type: JobType.IMAGE_TO_VIDEO,
        prompt: 'A futuristic cyberpunk city at night with neon lights, cinematic camera movement',
        negativePrompt: 'blurry, low quality, distorted face, artifacts',
        modelName: 'turbo-diffusion-v1',
        turboEnabled: true,
        status: JobStatus.COMPLETED,
        progress: 100,
        provider: 'modal',
        externalJobId: 'modal_seed_job_001',
        startedAt: new Date(),
        completedAt: new Date(),
        extraConfig: {
          seedKey: SEED.jobSeedKey,
          durationSec: 6,
          aspectRatio: '16:9',
          fps: 30,
          source: 'seed',
        },
        logs: {
          create: [
            { message: 'Job created by seed' },
            { message: 'Input image linked' },
            { message: 'Queued to BullMQ (seed)' },
            { message: 'Processing started (seed)' },
            { message: 'Modal generation completed successfully (seed)' },
          ],
        },
      },
    });

    console.log('✅ Created job:', job.id);
  } else {
    console.log('✅ Reused existing seeded job:', job.id);
  }

  // 4) Input Asset (IMAGE / INPUT)
  let inputAsset = await prisma.asset.findFirst({
    where: {
      userId: user.id,
      jobId: job.id,
      type: AssetType.IMAGE,
      role: AssetRole.INPUT,
    },
  });

  if (!inputAsset) {
    inputAsset = await prisma.asset.create({
      data: {
        userId: user.id,
        jobId: job.id,
        type: AssetType.IMAGE,
        role: AssetRole.INPUT,
        mimeType: 'image/png',
        originalName: 'cyberpunk-source.png',
      },
    });
    console.log('✅ Created input asset:', inputAsset.id);
  } else {
    console.log('✅ Reused existing input asset:', inputAsset.id);
  }

  // 5) Input AssetVersion
  const inputBucket = 'neuragen';
  const inputObjectKey = 'neuragen/jobs/seed-job/input/cyberpunk-source.png';

  let inputAssetVersion = await prisma.assetVersion.findFirst({
    where: {
      assetId: inputAsset.id,
      metadata: {
        path: ['seedKey'],
        equals: SEED.inputAssetSeedKey,
      },
    },
  });

  if (!inputAssetVersion) {
    inputAssetVersion = await prisma.assetVersion.upsert({
      where: {
        assetId_version: {
          assetId: inputAsset.id,
          version: 1,
        },
      },
      update: {
        storageProvider: StorageProvider.S3,
        bucket: inputBucket,
        objectKey: inputObjectKey,
        fileUrl: null,
        originalName: 'cyberpunk-source.png',
        mimeType: 'image/png',
        sizeBytes: 512000,
        width: 1024,
        height: 576,
        quality: 'SOURCE',
        metadata: {
          seedKey: SEED.inputAssetSeedKey,
          source: 'seed',
          kind: 'input-image',
        },
      },
      create: {
        assetId: inputAsset.id,
        version: 1,
        storageProvider: StorageProvider.S3,
        bucket: inputBucket,
        objectKey: inputObjectKey,
        fileUrl: null,
        originalName: 'cyberpunk-source.png',
        mimeType: 'image/png',
        sizeBytes: 512000,
        width: 1024,
        height: 576,
        quality: 'SOURCE',
        metadata: {
          seedKey: SEED.inputAssetSeedKey,
          source: 'seed',
          kind: 'input-image',
        },
      },
    });

    console.log('✅ Created/Upserted input assetVersion:', inputAssetVersion.id);
  } else {
    console.log('✅ Reused existing input assetVersion:', inputAssetVersion.id);
  }

  // 6) Output Asset (VIDEO / OUTPUT)
  let outputAsset = await prisma.asset.findFirst({
    where: {
      userId: user.id,
      jobId: job.id,
      type: AssetType.VIDEO,
      role: AssetRole.OUTPUT,
    },
  });

  if (!outputAsset) {
    outputAsset = await prisma.asset.create({
      data: {
        userId: user.id,
        jobId: job.id,
        type: AssetType.VIDEO,
        role: AssetRole.OUTPUT,
        mimeType: 'video/mp4',
        originalName: 'cyberpunk-output.mp4',
      },
    });
    console.log('✅ Created output asset:', outputAsset.id);
  } else {
    console.log('✅ Reused existing output asset:', outputAsset.id);
  }

  // 7) Output AssetVersion
  const outputBucket = 'neuragen';
  const outputObjectKey = 'neuragen/jobs/seed-job/output/cyberpunk-result.mp4';

  let outputAssetVersion = await prisma.assetVersion.findFirst({
    where: {
      assetId: outputAsset.id,
      metadata: {
        path: ['seedKey'],
        equals: SEED.outputAssetSeedKey,
      },
    },
  });

  if (!outputAssetVersion) {
    outputAssetVersion = await prisma.assetVersion.upsert({
      where: {
        assetId_version: {
          assetId: outputAsset.id,
          version: 1,
        },
      },
      update: {
        storageProvider: StorageProvider.S3,
        bucket: outputBucket,
        objectKey: outputObjectKey,
        fileUrl: null,
        originalName: 'cyberpunk-output.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4_500_000,
        width: 1024,
        height: 576,
        durationMs: 6000,
        quality: 'HD',
        metadata: {
          seedKey: SEED.outputAssetSeedKey,
          source: 'seed',
          kind: 'output-video',
          fps: 30,
        },
      },
      create: {
        assetId: outputAsset.id,
        version: 1,
        storageProvider: StorageProvider.S3,
        bucket: outputBucket,
        objectKey: outputObjectKey,
        fileUrl: null,
        originalName: 'cyberpunk-output.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4_500_000,
        width: 1024,
        height: 576,
        durationMs: 6000,
        quality: 'HD',
        metadata: {
          seedKey: SEED.outputAssetSeedKey,
          source: 'seed',
          kind: 'output-video',
          fps: 30,
        },
      },
    });

    console.log('✅ Created/Upserted output assetVersion:', outputAssetVersion.id);
  } else {
    console.log('✅ Reused existing output assetVersion:', outputAssetVersion.id);
  }

  // 8) GalleryItem cho output video
  const existingGallery = await prisma.galleryItem.findFirst({
    where: {
      userId: user.id,
      assetVersionId: outputAssetVersion.id,
    },
  });

  if (!existingGallery) {
    await prisma.galleryItem.create({
      data: {
        userId: user.id,
        assetVersionId: outputAssetVersion.id,
        isPublic: true,
      },
    });
    console.log('✅ Created gallery item for output video');
  } else {
    console.log('✅ Reused existing gallery item:', existingGallery.id);
  }

  console.log('🎉 Seed completed (idempotent).');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });