import {
  PrismaClient,
  UserRole,
  JobType,
  JobStatus,
  AssetType,
  AssetRole,
  StorageProvider,
} from '@prisma/client';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import * as bcrypt from 'bcrypt';
import { basename, extname } from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});
const DEFAULT_THUMBNAIL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBQWFhUVFRUVFRUVFRUVFRUVFhUXFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGi0fHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFhABAQEAAAAAAAAAAAAAAAAAAQAC/9oADAMBAAIQAxAAAAGvAH//xAAVEAEBAAAAAAAAAAAAAAAAAAABEP/aAAgBAQABBQKf/8QAFhEBAQEAAAAAAAAAAAAAAAAAABEB/9oACAEDAQE/Aaf/xAAVEQEBAAAAAAAAAAAAAAAAAAAAEf/aAAgBAgEBPwGn/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQAGPwJf/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQABPyFf/9k=';

// Seed keys để chạy nhiều lần không trùng logic
const SEED = {
  jobSeedKey: 'seed:v2:job:image_to_video:cyberpunk_city',
  inputAssetSeedKey: 'seed:v2:asset:input:image',
  outputAssetSeedKey: 'seed:v2:asset:output:video',
  outputThumbnailSeedKey: 'seed:v2:asset:thumbnail:video',
};

const SEED_USERS = [
  {
    email: 'free.user@gmail.com',
    password: 'FreeUser@123',
    username: 'free_creator',
    role: UserRole.FREE,
    bio: 'Free plan user for baseline explore/feed tests.',
    avatarUrl: 'https://i.pravatar.cc/256?img=12',
    creditBalance: 120,
  },
  {
    email: 'pro.user@gmail.com',
    password: 'ProUser@123',
    username: 'pro_editor',
    role: UserRole.PRO,
    bio: 'Pro plan creator with higher activity in cinematic topics.',
    avatarUrl: 'https://i.pravatar.cc/256?img=32',
    creditBalance: 900,
    proDays: 30,
  },
  {
    email: 'admin.user@gmail.com',
    password: 'AdminUser@123',
    username: 'admin_ops',
    role: UserRole.ADMIN,
    bio: 'Administrator account used for moderation and ops checks.',
    avatarUrl: 'https://i.pravatar.cc/256?img=5',
    creditBalance: 5000,
  },
] as const;

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

const DEFAULT_EXPLORE_S3_MANIFEST: ExploreSeedManifestItem[] = [
  {
    key: 'seed:v4:explore:astronaut-mars',
    title: "Astronaut's Martian Adventure",
    topic: 'scifi',
    caption: "Astronaut's Martian adventure with cinematic orbit cam #scifi",
    score: 23.8,
    isTrending: true,
    likeCount: 34,
    commentCount: 9,
    viewCount: 980,
    ageHours: 8,
    fileUrl: 's3://neuragen/neuragen/jobs/Astronaut_s_Martian_Adventure.mp4',
    durationMs: 6500,
  },
  {
    key: 'seed:v4:explore:cat-car',
    title: 'Cat Driving Tiny Car',
    topic: 'animals',
    caption: 'Tiny cat driving mini car with playful motion #animals',
    score: 19.4,
    isTrending: true,
    likeCount: 29,
    commentCount: 6,
    viewCount: 760,
    ageHours: 14,
    fileUrl: 's3://neuragen/neuragen/jobs/Cat_Driving_Tiny_Car_Video.mp4',
    durationMs: 5800,
  },
  {
    key: 'seed:v4:explore:corgi-beach',
    title: 'Corgi Beach Run',
    topic: 'animals',
    caption: 'Happy corgi running on beach, sunny vibe #animals #landscape',
    score: 18.1,
    isTrending: false,
    likeCount: 21,
    commentCount: 4,
    viewCount: 520,
    ageHours: 22,
    fileUrl: 's3://neuragen/neuragen/jobs/Corgi_Beach_Video_Generation.mp4',
    durationMs: 6200,
  },
  {
    key: 'seed:v4:explore:cyberpunk-rain',
    title: 'Cyberpunk City Night Rain',
    topic: 'scifi',
    caption: 'Cyberpunk city rain with neon reflections and dolly shot #scifi',
    score: 25.2,
    isTrending: true,
    likeCount: 42,
    commentCount: 10,
    viewCount: 1340,
    ageHours: 5,
    fileUrl: 's3://neuragen/neuragen/jobs/Cyberpunk_City_Night_Rain_Video.mp4',
    durationMs: 7000,
  },
  {
    key: 'seed:v4:explore:banana-disco',
    title: 'Dancing Banana Disco',
    topic: 'funny',
    caption: 'Dancing banana under disco lights with retro camera shake #funny',
    score: 16.8,
    isTrending: false,
    likeCount: 16,
    commentCount: 3,
    viewCount: 410,
    ageHours: 30,
    fileUrl: 's3://neuragen/neuragen/jobs/Dancing_Banana_Disco_Video_Generated.mp4',
    durationMs: 5400,
  },
  {
    key: 'seed:v4:explore:dragon-castle',
    title: 'Dragon Over Castle',
    topic: 'fantasy',
    caption: 'Dragon flies above ancient castle in golden hour haze #fantasy',
    score: 21.6,
    isTrending: true,
    likeCount: 31,
    commentCount: 7,
    viewCount: 860,
    ageHours: 11,
    fileUrl: 's3://neuragen/neuragen/jobs/Dragon_Over_Castle_Video_Generated.mp4',
    durationMs: 6800,
  },
  {
    key: 'seed:v4:explore:misty-mountain',
    title: 'Misty Mountain Sunrise',
    topic: 'fantasy',
    caption: 'Misty mountain sunrise at fantasy kingdom frontier #fantasy',
    score: 17.3,
    isTrending: false,
    likeCount: 19,
    commentCount: 5,
    viewCount: 470,
    ageHours: 26,
    fileUrl: 's3://neuragen/neuragen/jobs/Misty_Mountain_Sunrise_Video_Generated.mp4',
    durationMs: 6000,
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

function parseS3Uri(input: string) {
  if (!input.startsWith('s3://')) {
    return null;
  }

  const withoutScheme = input.slice('s3://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  const bucket = withoutScheme.slice(0, slashIndex);
  const objectKey = withoutScheme.slice(slashIndex + 1);

  if (!bucket || !objectKey) {
    return null;
  }

  return { bucket, objectKey };
}

type ExploreSeedManifestItem = {
  key?: string;
  title?: string;
  topic?: string;
  caption?: string;
  score?: number;
  isTrending?: boolean;
  likeCount?: number;
  commentCount?: number;
  viewCount?: number;
  ageHours?: number;
  mimeType?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  quality?: string;
  fileUrl?: string;
  objectKey?: string;
  bucket?: string;
  localPath?: string;
};

function sanitizeTopic(input?: string) {
  const topic = (input ?? 'general').trim().toLowerCase();
  return topic || 'general';
}

function buildThumbnailObjectKey(videoObjectKey: string) {
  const extension = extname(videoObjectKey);
  if (!extension) return `${videoObjectKey}-thumbnail.jpg`;
  return `${videoObjectKey.slice(0, -extension.length)}-thumbnail.jpg`;
}

async function ensureS3ThumbnailObject(bucket: string, objectKey: string) {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );
    return;
  } catch (error) {
    const s3Error = error as S3ServiceException;
    const status = s3Error?.$metadata?.httpStatusCode;
    if (status && status !== 404) {
      console.warn(
        `⚠️ Cannot verify thumbnail object ${bucket}/${objectKey} (status: ${status})`,
      );
      return;
    }
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: Buffer.from(DEFAULT_THUMBNAIL_JPEG_BASE64, 'base64'),
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  console.log(`✅ Uploaded placeholder thumbnail: s3://${bucket}/${objectKey}`);
}

async function ensureSeedJobForVideo(options: {
  userId: string;
  seedKey: string;
  prompt: string;
  createdAt: Date;
}) {
  const existing = await prisma.generateJob.findFirst({
    where: {
      userId: options.userId,
      extraConfig: {
        path: ['seedKey'],
        equals: options.seedKey,
      },
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.generateJob.create({
    data: {
      userId: options.userId,
      type: JobType.IMAGE_TO_VIDEO,
      prompt: options.prompt,
      modelName: 'seed-model',
      status: JobStatus.COMPLETED,
      progress: 100,
      provider: 'seed',
      startedAt: options.createdAt,
      completedAt: options.createdAt,
      createdAt: options.createdAt,
      extraConfig: {
        seedKey: options.seedKey,
        source: 'seed',
        kind: 'explore-seed-job',
      },
    },
  });
}

async function ensureThumbnailForVideoAssetVersion(options: {
  userId: string;
  seedKey: string;
  prompt: string;
  createdAt: Date;
  videoAssetId: string;
  videoVersionBucket: string;
  videoVersionObjectKey: string;
}) {
  const job = await ensureSeedJobForVideo({
    userId: options.userId,
    seedKey: `${options.seedKey}:job`,
    prompt: options.prompt,
    createdAt: options.createdAt,
  });

  await prisma.asset.update({
    where: { id: options.videoAssetId },
    data: { jobId: job.id },
  });

  let thumbnailAsset = await prisma.asset.findFirst({
    where: {
      userId: options.userId,
      jobId: job.id,
      type: AssetType.THUMBNAIL,
      role: AssetRole.THUMBNAIL,
    },
  });

  if (!thumbnailAsset) {
    thumbnailAsset = await prisma.asset.create({
      data: {
        userId: options.userId,
        jobId: job.id,
        type: AssetType.THUMBNAIL,
        role: AssetRole.THUMBNAIL,
        mimeType: 'image/jpeg',
        originalName: `${basename(options.videoVersionObjectKey, extname(options.videoVersionObjectKey))}-thumbnail.jpg`,
      },
    });
  }

  const thumbnailObjectKey = buildThumbnailObjectKey(options.videoVersionObjectKey);
  const thumbnailFileUrl = buildS3PublicUrl(
    options.videoVersionBucket,
    thumbnailObjectKey,
  );
  await ensureS3ThumbnailObject(options.videoVersionBucket, thumbnailObjectKey);

  await prisma.assetVersion.upsert({
    where: {
      assetId_version: {
        assetId: thumbnailAsset.id,
        version: 1,
      },
    },
    update: {
      storageProvider: StorageProvider.S3,
      bucket: options.videoVersionBucket,
      objectKey: thumbnailObjectKey,
      fileUrl: thumbnailFileUrl,
      originalName: `${basename(options.videoVersionObjectKey, extname(options.videoVersionObjectKey))}-thumbnail.jpg`,
      mimeType: 'image/jpeg',
      width: 1024,
      height: 576,
      quality: 'THUMBNAIL',
      metadata: {
        seedKey: `${options.seedKey}:thumbnail`,
        source: 'seed',
        kind: 'explore-thumbnail',
      },
    },
    create: {
      assetId: thumbnailAsset.id,
      version: 1,
      storageProvider: StorageProvider.S3,
      bucket: options.videoVersionBucket,
      objectKey: thumbnailObjectKey,
      fileUrl: thumbnailFileUrl,
      originalName: `${basename(options.videoVersionObjectKey, extname(options.videoVersionObjectKey))}-thumbnail.jpg`,
      mimeType: 'image/jpeg',
      width: 1024,
      height: 576,
      quality: 'THUMBNAIL',
      metadata: {
        seedKey: `${options.seedKey}:thumbnail`,
        source: 'seed',
        kind: 'explore-thumbnail',
      },
    },
  });
}

function parseExploreManifestFromEnv() {
  const inline = process.env.SEED_EXPLORE_MANIFEST_JSON?.trim();
  const path = process.env.SEED_EXPLORE_MANIFEST_PATH?.trim();

  if (inline) {
    return JSON.parse(inline) as ExploreSeedManifestItem[];
  }

  if (path && fs.existsSync(path)) {
    const raw = fs.readFileSync(path, 'utf-8');
    return JSON.parse(raw) as ExploreSeedManifestItem[];
  }

  return DEFAULT_EXPLORE_S3_MANIFEST;
}

async function main() {
  console.log('🌱 Seeding database (idempotent)...');

  // 1) Users theo role + dữ liệu hồ sơ cơ bản
  const seededUsers = await Promise.all(
    SEED_USERS.map(async (seedUser) => {
      const passwordHash = await bcrypt.hash(seedUser.password, 10);
      return prisma.user.upsert({
        where: { email: seedUser.email },
        update: {
          password: passwordHash,
          username: seedUser.username,
          role: seedUser.role,
          bio: seedUser.bio,
          avatarUrl: seedUser.avatarUrl,
          ...(seedUser.role === UserRole.PRO && seedUser.proDays
            ? {
                proExpiresAt: new Date(
                  Date.now() + seedUser.proDays * 24 * 60 * 60 * 1000,
                ),
              }
            : {}),
        },
        create: {
          email: seedUser.email,
          password: passwordHash,
          username: seedUser.username,
          role: seedUser.role,
          bio: seedUser.bio,
          avatarUrl: seedUser.avatarUrl,
          ...(seedUser.role === UserRole.PRO && seedUser.proDays
            ? {
                proExpiresAt: new Date(
                  Date.now() + seedUser.proDays * 24 * 60 * 60 * 1000,
                ),
              }
            : {}),
        },
      });
    }),
  );

  for (let i = 0; i < seededUsers.length; i++) {
    const seedUser = SEED_USERS[i];
    const user = seededUsers[i];

    await prisma.userCredit.upsert({
      where: { userId: user.id },
      update: { balance: seedUser.creditBalance },
      create: {
        userId: user.id,
        balance: seedUser.creditBalance,
      },
    });

    console.log(`✅ User ready: ${user.email} (${user.role})`);
  }

  const freeUser = seededUsers.find((u) => u.role === UserRole.FREE);
  const proUser = seededUsers.find((u) => u.role === UserRole.PRO);
  const adminUser = seededUsers.find((u) => u.role === UserRole.ADMIN);

  if (!freeUser || !proUser || !adminUser) {
    throw new Error('Seed users for FREE/PRO/ADMIN were not created correctly.');
  }

  // 2) Dữ liệu quan hệ user cơ bản (follow + topic profile)
  await prisma.follow.upsert({
    where: {
      followerId_followingId: {
        followerId: freeUser.id,
        followingId: proUser.id,
      },
    },
    update: {},
    create: {
      followerId: freeUser.id,
      followingId: proUser.id,
    },
  });

  await prisma.follow.upsert({
    where: {
      followerId_followingId: {
        followerId: proUser.id,
        followingId: freeUser.id,
      },
    },
    update: {},
    create: {
      followerId: proUser.id,
      followingId: freeUser.id,
    },
  });

  await prisma.userTopicProfile.upsert({
    where: {
      userId_topic: {
        userId: freeUser.id,
        topic: 'anime',
      },
    },
    update: {
      score: 0.42,
      lastEventAt: new Date(),
    },
    create: {
      userId: freeUser.id,
      topic: 'anime',
      score: 0.42,
      lastEventAt: new Date(),
    },
  });

  await prisma.userTopicProfile.upsert({
    where: {
      userId_topic: {
        userId: proUser.id,
        topic: 'cinematic',
      },
    },
    update: {
      score: 0.67,
      lastEventAt: new Date(),
    },
    create: {
      userId: proUser.id,
      topic: 'cinematic',
      score: 0.67,
      lastEventAt: new Date(),
    },
  });

  console.log('✅ User profile/follow/topic data ready');

  // 3) GenerateJob
  let job = await prisma.generateJob.findFirst({
    where: {
      userId: freeUser.id,
      extraConfig: {
        path: ['seedKey'],
        equals: SEED.jobSeedKey,
      },
    },
  });

  if (!job) {
    job = await prisma.generateJob.create({
      data: {
        userId: freeUser.id,
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
      userId: freeUser.id,
      jobId: job.id,
      type: AssetType.IMAGE,
      role: AssetRole.INPUT,
    },
  });

  if (!inputAsset) {
    inputAsset = await prisma.asset.create({
      data: {
        userId: freeUser.id,
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
      userId: freeUser.id,
      jobId: job.id,
      type: AssetType.VIDEO,
      role: AssetRole.OUTPUT,
    },
  });

  if (!outputAsset) {
    outputAsset = await prisma.asset.create({
      data: {
        userId: freeUser.id,
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

  let outputThumbnailAsset = await prisma.asset.findFirst({
    where: {
      userId: freeUser.id,
      jobId: job.id,
      type: AssetType.THUMBNAIL,
      role: AssetRole.THUMBNAIL,
    },
  });

  if (!outputThumbnailAsset) {
    outputThumbnailAsset = await prisma.asset.create({
      data: {
        userId: freeUser.id,
        jobId: job.id,
        type: AssetType.THUMBNAIL,
        role: AssetRole.THUMBNAIL,
        mimeType: 'image/jpeg',
        originalName: 'cyberpunk-output-thumbnail.jpg',
      },
    });
    console.log('✅ Created output thumbnail asset:', outputThumbnailAsset.id);
  } else {
    console.log('✅ Reused existing output thumbnail asset:', outputThumbnailAsset.id);
  }

  await prisma.assetVersion.upsert({
    where: {
      assetId_version: {
        assetId: outputThumbnailAsset.id,
        version: 1,
      },
    },
    update: {
      storageProvider: StorageProvider.S3,
      bucket: outputBucket,
      objectKey: buildThumbnailObjectKey(outputObjectKey),
      fileUrl: buildS3PublicUrl(outputBucket, buildThumbnailObjectKey(outputObjectKey)),
      originalName: 'cyberpunk-output-thumbnail.jpg',
      mimeType: 'image/jpeg',
      width: 1024,
      height: 576,
      quality: 'THUMBNAIL',
      metadata: {
        seedKey: SEED.outputThumbnailSeedKey,
        source: 'seed',
        kind: 'output-thumbnail',
      },
    },
    create: {
      assetId: outputThumbnailAsset.id,
      version: 1,
      storageProvider: StorageProvider.S3,
      bucket: outputBucket,
      objectKey: buildThumbnailObjectKey(outputObjectKey),
      fileUrl: buildS3PublicUrl(outputBucket, buildThumbnailObjectKey(outputObjectKey)),
      originalName: 'cyberpunk-output-thumbnail.jpg',
      mimeType: 'image/jpeg',
      width: 1024,
      height: 576,
      quality: 'THUMBNAIL',
      metadata: {
        seedKey: SEED.outputThumbnailSeedKey,
        source: 'seed',
        kind: 'output-thumbnail',
      },
    },
  });
  await ensureS3ThumbnailObject(
    outputBucket,
    buildThumbnailObjectKey(outputObjectKey),
  );

  // 8) GalleryItem cho output video
  const existingGallery = await prisma.galleryItem.findFirst({
    where: {
      userId: freeUser.id,
      assetVersionId: outputAssetVersion.id,
    },
  });

  if (!existingGallery) {
    await prisma.galleryItem.create({
      data: {
        userId: freeUser.id,
        assetVersionId: outputAssetVersion.id,
        isPublic: true,
      },
    });
    console.log('✅ Created gallery item for output video');
  } else {
    console.log('✅ Reused existing gallery item:', existingGallery.id);
  }

  // 9) Optional: thêm assetVersion từ dữ liệu có sẵn (S3/url/local manifest)
  const seededExploreAssetVersions = [outputAssetVersion];
  const configuredS3Keys = parseCsvEnv('SEED_EXPLORE_S3_KEYS');
  const configuredFileUrls = parseCsvEnv('SEED_EXPLORE_FILE_URLS');
  const configuredLocalPaths = parseCsvEnv('SEED_EXPLORE_LOCAL_PATHS');
  const configuredBucket =
    process.env.SEED_EXPLORE_S3_BUCKET ||
    process.env.AWS_S3_BUCKET ||
    outputBucket;
  const localPublicBaseUrl = process.env.SEED_LOCAL_PUBLIC_BASE_URL?.trim();
  const manifestItems = parseExploreManifestFromEnv();

  for (let i = 0; i < manifestItems.length; i++) {
    const item = manifestItems[i];
    const seedKey = item.key || `seed:v4:asset:explore:manifest:${i}`;
    const parsedS3FromFileUrl = item.fileUrl ? parseS3Uri(item.fileUrl) : null;
    const fallbackObjectKey = `seed/explore/manifest/${i}-${Date.now()}.mp4`;
    const chosenObjectKey =
      parsedS3FromFileUrl?.objectKey ||
      item.objectKey ||
      (item.localPath ? `seed/explore/local/${basename(item.localPath)}` : fallbackObjectKey);
    const chosenBucket =
      parsedS3FromFileUrl?.bucket || item.bucket || configuredBucket || 'seed-external';

    const resolvedFileUrl =
      (parsedS3FromFileUrl
        ? buildS3PublicUrl(parsedS3FromFileUrl.bucket, parsedS3FromFileUrl.objectKey)
        : null) ||
      item.fileUrl ||
      (item.objectKey ? buildS3PublicUrl(chosenBucket, chosenObjectKey) : null) ||
      (item.localPath && localPublicBaseUrl
        ? `${localPublicBaseUrl.replace(/\/$/, '')}/${basename(item.localPath)}`
        : null);

    let version = await prisma.assetVersion.findFirst({
      where: {
        metadata: {
          path: ['seedKey'],
          equals: seedKey,
        },
      },
    });

      if (!version) {
      const createdAt = new Date(Date.now() - (item.ageHours ?? 4) * 60 * 60 * 1000);
      const seedJob = await ensureSeedJobForVideo({
        userId: freeUser.id,
        seedKey: `${seedKey}:job`,
        prompt: item.caption || item.title || `Seed video ${i + 1}`,
        createdAt,
      });

      const asset = await prisma.asset.create({
        data: {
          userId: freeUser.id,
          jobId: seedJob.id,
          type: AssetType.VIDEO,
          role: AssetRole.OUTPUT,
          mimeType: item.mimeType || 'video/mp4',
          originalName: basename(item.localPath || chosenObjectKey),
        },
      });

      version = await prisma.assetVersion.create({
        data: {
          assetId: asset.id,
          version: 1,
          storageProvider: StorageProvider.S3,
          bucket: chosenBucket,
          objectKey: chosenObjectKey,
          fileUrl: resolvedFileUrl,
          originalName: basename(item.localPath || chosenObjectKey),
          mimeType: item.mimeType || 'video/mp4',
          quality: item.quality || 'HD',
          width: item.width || 1024,
          height: item.height || 576,
          durationMs: item.durationMs || 6000,
          metadata: {
            seedKey,
            source: 'seed',
            kind: 'explore-video-manifest',
            localPath: item.localPath || null,
          },
        },
      });
      console.log('✅ Added explore assetVersion from manifest:', seedKey);
    }

    await ensureThumbnailForVideoAssetVersion({
      userId: freeUser.id,
      seedKey,
      prompt: item.caption || item.title || `Seed video ${i + 1}`,
      createdAt: new Date(Date.now() - (item.ageHours ?? 4) * 60 * 60 * 1000),
      videoAssetId: version.assetId,
      videoVersionBucket: version.bucket,
      videoVersionObjectKey: version.objectKey,
    });

    seededExploreAssetVersions.push(version);

    if (item.title || item.caption) {
      const caption =
        item.caption ||
        `${item.title ?? 'Explore drop'} #${sanitizeTopic(item.topic)} - ${seedKey}`;
      const createdAt = new Date(
        Date.now() - (item.ageHours ?? 4) * 60 * 60 * 1000,
      );

      let post = await prisma.post.findFirst({
        where: {
          userId: freeUser.id,
          caption,
        },
      });

      if (!post) {
        post = await prisma.post.create({
          data: {
            userId: freeUser.id,
            assetVersionId: version.id,
            caption,
            isPublic: true,
            likeCount: item.likeCount ?? 5,
            commentCount: item.commentCount ?? 1,
            viewCount: item.viewCount ?? 80,
            createdAt,
          },
        });
      }

      await prisma.exploreItem.upsert({
        where: { postId: post.id },
        update: {
          assetVersionId: version.id,
          title: item.title || caption.slice(0, 100),
          topic: sanitizeTopic(item.topic),
          isTrending: item.isTrending ?? false,
          score: item.score ?? 10,
        },
        create: {
          postId: post.id,
          assetVersionId: version.id,
          title: item.title || caption.slice(0, 100),
          topic: sanitizeTopic(item.topic),
          isTrending: item.isTrending ?? false,
          score: item.score ?? 10,
          createdAt,
        },
      });
    }
  }

  for (let i = 0; i < configuredS3Keys.length; i++) {
    const rawS3Input = configuredS3Keys[i];
    const parsedS3Input = parseS3Uri(rawS3Input);
    const objectKey = parsedS3Input?.objectKey || rawS3Input;
    const targetBucket = parsedS3Input?.bucket || configuredBucket;
    const publicUrl =
      configuredFileUrls[i] || buildS3PublicUrl(targetBucket, objectKey);
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
      const seedJob = await ensureSeedJobForVideo({
        userId: freeUser.id,
        seedKey: `${seedKey}:job`,
        prompt: `Seed env video ${i + 1}`,
        createdAt: new Date(),
      });

      const asset = await prisma.asset.create({
        data: {
          userId: freeUser.id,
          jobId: seedJob.id,
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
          bucket: targetBucket,
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

    await ensureThumbnailForVideoAssetVersion({
      userId: freeUser.id,
      seedKey,
      prompt: `Seed env video ${i + 1}`,
      createdAt: new Date(),
      videoAssetId: version.assetId,
      videoVersionBucket: version.bucket,
      videoVersionObjectKey: version.objectKey,
    });

    seededExploreAssetVersions.push(version);
  }

  for (let i = 0; i < configuredLocalPaths.length; i++) {
    const localPath = configuredLocalPaths[i];
    const seedKey = `seed:v4:asset:explore:local:${i}`;

    let version = await prisma.assetVersion.findFirst({
      where: {
        metadata: {
          path: ['seedKey'],
          equals: seedKey,
        },
      },
    });

    if (!version) {
      const syntheticObjectKey = `seed/explore/local/${basename(localPath)}`;
      const resolvedLocalUrl = localPublicBaseUrl
        ? `${localPublicBaseUrl.replace(/\/$/, '')}/${basename(localPath)}`
        : null;
      const seedJob = await ensureSeedJobForVideo({
        userId: freeUser.id,
        seedKey: `${seedKey}:job`,
        prompt: `Seed local video ${i + 1}`,
        createdAt: new Date(),
      });

      const asset = await prisma.asset.create({
        data: {
          userId: freeUser.id,
          jobId: seedJob.id,
          type: AssetType.VIDEO,
          role: AssetRole.OUTPUT,
          mimeType: 'video/mp4',
          originalName: basename(localPath),
        },
      });

      version = await prisma.assetVersion.create({
        data: {
          assetId: asset.id,
          version: 1,
          storageProvider: StorageProvider.S3,
          bucket: configuredBucket,
          objectKey: syntheticObjectKey,
          fileUrl: resolvedLocalUrl,
          originalName: basename(localPath),
          mimeType: 'video/mp4',
          quality: 'HD',
          width: 1024,
          height: 576,
          durationMs: 6000,
          metadata: {
            seedKey,
            source: 'seed',
            kind: 'explore-video-local',
            localPath,
          },
        },
      });
      console.log('✅ Added explore assetVersion from local path:', localPath);
    }

    await ensureThumbnailForVideoAssetVersion({
      userId: freeUser.id,
      seedKey,
      prompt: `Seed local video ${i + 1}`,
      createdAt: new Date(),
      videoAssetId: version.assetId,
      videoVersionBucket: version.bucket,
      videoVersionObjectKey: version.objectKey,
    });

    seededExploreAssetVersions.push(version);
  }

  // 10) Seed post/explore fallback chỉ khi không có manifest
  if (manifestItems.length === 0) {
    for (let i = 0; i < EXPLORE_SEED_POSTS.length; i++) {
      const seedPost = EXPLORE_SEED_POSTS[i];
      const selectedVersion =
        seededExploreAssetVersions[i % seededExploreAssetVersions.length];
      const createdAt = new Date(
        Date.now() - seedPost.ageHours * 60 * 60 * 1000,
      );

      let post = await prisma.post.findFirst({
        where: {
          userId: freeUser.id,
          caption: seedPost.caption,
        },
      });

      if (!post) {
        post = await prisma.post.create({
          data: {
            userId: freeUser.id,
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
          userId: freeUser.id,
          assetVersionId: selectedVersion.id,
        },
      });

      if (!exploreGalleryItem) {
        await prisma.galleryItem.create({
          data: {
            userId: freeUser.id,
            assetVersionId: selectedVersion.id,
            isPublic: true,
          },
        });
      }
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
