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
import { basename } from 'path';

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

const EXPLORE_SEED_POSTS = [
  {
    key: 'seed:v3:explore:cyberpunk',
    caption:
      'Neon city rain test shot #cyberpunk #cinematic - seed:v3:explore:cyberpunk',
    title: 'Neon Rain City',
    topic: 'scifi',
    score: 24.5,
    isTrending: true,
    likeCount: 28,
    commentCount: 9,
    viewCount: 610,
    ageHours: 6,
  },
  {
    key: 'seed:v3:explore:anime',
    caption: 'Anime motion clip #anime #portrait - seed:v3:explore:anime',
    title: 'Anime Portrait Motion',
    topic: 'anime',
    score: 18.9,
    isTrending: true,
    likeCount: 15,
    commentCount: 4,
    viewCount: 320,
    ageHours: 14,
  },
  {
    key: 'seed:v3:explore:forest',
    caption:
      'Forest aerial movement, soft camera pan #landscape - seed:v3:explore:forest',
    title: 'Forest Aerial Pan',
    topic: 'landscape',
    score: 13.2,
    isTrending: false,
    likeCount: 8,
    commentCount: 2,
    viewCount: 140,
    ageHours: 30,
  },
  {
    key: 'seed:v3:explore:film',
    caption:
      'Movie style motion test with depth #cinematic - seed:v3:explore:film',
    title: 'Film Depth Test',
    topic: 'cinematic',
    score: 16.4,
    isTrending: true,
    likeCount: 11,
    commentCount: 3,
    viewCount: 210,
    ageHours: 20,
  },
  {
    key: 'seed:v3:explore:new-drop',
    caption: 'Fresh drop just now #scifi - seed:v3:explore:new-drop',
    title: 'Fresh Sci-fi Drop',
    topic: 'scifi',
    score: 10.8,
    isTrending: false,
    likeCount: 2,
    commentCount: 0,
    viewCount: 35,
    ageHours: 2,
  },
];

function parseCsvEnv(name: string) {
  return (process.env[name] ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function buildS3PublicUrl(bucket: string, objectKey: string) {
  const region = process.env.AWS_REGION || 'us-east-1';
  return `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;
}

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
        prompt:
          'A futuristic cyberpunk city at night with neon lights, cinematic camera movement',
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

    console.log(
      '✅ Created/Upserted input assetVersion:',
      inputAssetVersion.id,
    );
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
  const outputFileUrl = buildS3PublicUrl(outputBucket, outputObjectKey);

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
        fileUrl: outputFileUrl,
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
        fileUrl: outputFileUrl,
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

    console.log(
      '✅ Created/Upserted output assetVersion:',
      outputAssetVersion.id,
    );
  } else {
    console.log(
      '✅ Reused existing output assetVersion:',
      outputAssetVersion.id,
    );
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

  // 9) Optional: thêm assetVersion từ S3 object có sẵn để Explore đa dạng hơn
  const seededExploreAssetVersions = [outputAssetVersion];
  const configuredS3Keys = parseCsvEnv('SEED_EXPLORE_S3_KEYS');
  const configuredFileUrls = parseCsvEnv('SEED_EXPLORE_FILE_URLS');
  const configuredBucket =
    process.env.SEED_EXPLORE_S3_BUCKET ||
    process.env.AWS_S3_BUCKET ||
    outputBucket;

  for (let i = 0; i < configuredS3Keys.length; i++) {
    const objectKey = configuredS3Keys[i];
    const publicUrl =
      configuredFileUrls[i] || buildS3PublicUrl(configuredBucket, objectKey);
    const seedKey = `seed:v3:asset:explore:${i}`;

    let version = await prisma.assetVersion.findFirst({
      where: {
        metadata: {
          path: ['seedKey'],
          equals: seedKey,
        },
      },
    });

    if (!version) {
      const asset = await prisma.asset.create({
        data: {
          userId: user.id,
          jobId: job.id,
          type: AssetType.VIDEO,
          role: AssetRole.OUTPUT,
          mimeType: 'video/mp4',
          originalName: basename(objectKey),
        },
      });

      version = await prisma.assetVersion.create({
        data: {
          assetId: asset.id,
          version: 1,
          storageProvider: StorageProvider.S3,
          bucket: configuredBucket,
          objectKey,
          fileUrl: publicUrl,
          originalName: basename(objectKey),
          mimeType: 'video/mp4',
          quality: 'HD',
          width: 1024,
          height: 576,
          durationMs: 6000,
          metadata: {
            seedKey,
            source: 'seed',
            kind: 'explore-video',
            fromEnv: true,
          },
        },
      });
      console.log('✅ Added explore assetVersion from S3 key:', objectKey);
    }

    seededExploreAssetVersions.push(version);
  }

  // 10) Seed vài post + explore item để trang Explore có dữ liệu ngay
  for (let i = 0; i < EXPLORE_SEED_POSTS.length; i++) {
    const seedPost = EXPLORE_SEED_POSTS[i];
    const selectedVersion =
      seededExploreAssetVersions[i % seededExploreAssetVersions.length];
    const createdAt = new Date(Date.now() - seedPost.ageHours * 60 * 60 * 1000);

    let post = await prisma.post.findFirst({
      where: {
        userId: user.id,
        caption: seedPost.caption,
      },
    });

    if (!post) {
      post = await prisma.post.create({
        data: {
          userId: user.id,
          assetVersionId: selectedVersion.id,
          caption: seedPost.caption,
          isPublic: true,
          likeCount: seedPost.likeCount,
          commentCount: seedPost.commentCount,
          viewCount: seedPost.viewCount,
          createdAt,
        },
      });
      console.log(`✅ Created explore post: ${seedPost.key}`);
    } else {
      post = await prisma.post.update({
        where: { id: post.id },
        data: {
          assetVersionId: selectedVersion.id,
          isPublic: true,
          likeCount: seedPost.likeCount,
          commentCount: seedPost.commentCount,
          viewCount: seedPost.viewCount,
        },
      });
      console.log(`✅ Reused explore post: ${seedPost.key}`);
    }

    await prisma.exploreItem.upsert({
      where: {
        postId: post.id,
      },
      update: {
        assetVersionId: selectedVersion.id,
        title: seedPost.title,
        topic: seedPost.topic,
        isTrending: seedPost.isTrending,
        score: seedPost.score,
      },
      create: {
        postId: post.id,
        assetVersionId: selectedVersion.id,
        title: seedPost.title,
        topic: seedPost.topic,
        isTrending: seedPost.isTrending,
        score: seedPost.score,
        createdAt,
      },
    });

    const exploreGalleryItem = await prisma.galleryItem.findFirst({
      where: {
        userId: user.id,
        assetVersionId: selectedVersion.id,
      },
    });

    if (!exploreGalleryItem) {
      await prisma.galleryItem.create({
        data: {
          userId: user.id,
          assetVersionId: selectedVersion.id,
          isPublic: true,
        },
      });
    }
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
