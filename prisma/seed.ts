import {
  PrismaClient,
  UserRole,
  JobType,
  JobStatus,
  AssetType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ✅ Seed keys để chạy nhiều lần không trùng
const SEED = {
  userEmail: 'test@neura.ai',
  userPassword: '123456',
  jobSeedKey: 'seed:v1:job:image_to_video:cyberpunk_city',
  assetVersionSeedKey: 'seed:v1:asset_version:video:sample_mp4',
};

async function main() {
  console.log('🌱 Seeding database (idempotent)...');

  // 1️⃣ User (idempotent bằng upsert theo unique email)
  const passwordHash = await bcrypt.hash(SEED.userPassword, 10);

  const user = await prisma.user.upsert({
    where: { email: SEED.userEmail },
    update: {
      // Nếu muốn update password mỗi lần seed thì mở dòng dưới
      // password: passwordHash,
    },
    create: {
      email: SEED.userEmail,
      password: passwordHash,
      role: UserRole.FREE,
    },
  });

  console.log('✅ User ready:', user.email);
  console.log('👉 USER ID:', user.id);

  // 1b) UserCredit (idempotent bằng upsert theo userId = @id)
  await prisma.userCredit.upsert({
    where: { userId: user.id },
    update: {
      // giữ nguyên nếu đã tồn tại; hoặc set lại balance theo ý bạn
      // balance: 100,
    },
    create: {
      userId: user.id,
      balance: 100,
    },
  });

  console.log('✅ UserCredit ready (balance=100 if created)');

  // 2️⃣ GenerateJob (idempotent nhờ extraConfig.seedKey)
  // Lưu ý: extraConfig chỉ chứa seedKey để filter ổn định
  let job = await prisma.generateJob.findFirst({
    where: {
      userId: user.id,
      // JSON filter cho PostgreSQL (Prisma 6+)
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
        prompt: 'A futuristic city at night, cyberpunk style',
        modelName: 'turbo-diffusion-v1',
        turboEnabled: true,
        status: JobStatus.DONE,
        progress: 100,
        extraConfig: { seedKey: SEED.jobSeedKey },
        logs: {
          create: [
            { message: 'Job created by seed' },
            { message: 'AI generation started (seed)' },
            { message: 'AI generation finished successfully (seed)' },
          ],
        },
      },
    });
    console.log('✅ Created job:', job.id);
  } else {
    console.log('✅ Reused existing seeded job:', job.id);
  }

  // 3️⃣ Asset (idempotent: tìm asset VIDEO theo jobId)
  let asset = await prisma.asset.findFirst({
    where: {
      jobId: job.id,
      type: AssetType.VIDEO,
    },
  });

  if (!asset) {
    asset = await prisma.asset.create({
      data: {
        jobId: job.id,
        type: AssetType.VIDEO,
      },
    });
    console.log('✅ Created asset:', asset.id);
  } else {
    console.log('✅ Reused existing asset:', asset.id);
  }

  // 4️⃣ AssetVersion (idempotent: ưu tiên tìm theo metadata.seedKey;
  // fallback: upsert theo unique (assetId, version))
  let assetVersion = await prisma.assetVersion.findFirst({
    where: {
      assetId: asset.id,
      metadata: {
        path: ['seedKey'],
        equals: SEED.assetVersionSeedKey,
      },
    },
  });

  if (!assetVersion) {
    // upsert theo compound unique @@unique([assetId, version])
    assetVersion = await prisma.assetVersion.upsert({
      where: {
        assetId_version: {
          assetId: asset.id,
          version: 1,
        },
      },
      update: {
        fileUrl: 'https://cdn.neura.ai/videos/sample.mp4',
        width: 1024,
        height: 576,
        quality: 'HD',
        metadata: {
          fps: 30,
          duration: 6,
          seedKey: SEED.assetVersionSeedKey,
          source: 'seed',
        },
      },
      create: {
        assetId: asset.id,
        version: 1,
        fileUrl: 'https://cdn.neura.ai/videos/sample.mp4',
        width: 1024,
        height: 576,
        quality: 'HD',
        metadata: {
          fps: 30,
          duration: 6,
          seedKey: SEED.assetVersionSeedKey,
          source: 'seed',
        },
      },
    });

    console.log('✅ Created/Upserted assetVersion:', assetVersion.id);
  } else {
    console.log('✅ Reused existing seeded assetVersion:', assetVersion.id);
  }

  // 5️⃣ GalleryItem (idempotent: findFirst theo userId + assetVersionId)
  const existingGallery = await prisma.galleryItem.findFirst({
    where: {
      userId: user.id,
      assetVersionId: assetVersion.id,
    },
  });

  if (!existingGallery) {
    await prisma.galleryItem.create({
      data: {
        userId: user.id,
        assetVersionId: assetVersion.id,
        isPublic: true,
      },
    });
    console.log('✅ Created gallery item');
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
