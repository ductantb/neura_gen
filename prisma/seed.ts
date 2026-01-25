import { PrismaClient, UserRole, JobType, JobStatus, AssetType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1️⃣ Create users
  const passwordHash = await bcrypt.hash('123456', 10);

  const user = await prisma.user.create({
    data: {
      email: 'test@neura.ai',
      password: passwordHash,
      role: UserRole.FREE,
      credits: {
        create: {
          balance: 100,
        },
      },
    },
  });

  console.log('✅ Created user:', user.email);

  // 2️⃣ Create generate job (IMAGE_TO_VIDEO)
  const job = await prisma.generateJob.create({
    data: {
      userId: user.id,
      type: JobType.IMAGE_TO_VIDEO,
      prompt: 'A futuristic city at night, cyberpunk style',
      modelName: 'turbo-diffusion-v1',
      turboEnabled: true,
      status: JobStatus.DONE,
      progress: 100,
    },
  });

  console.log('✅ Created job:', job.id);

  // 3️⃣ Create asset
const asset = await prisma.asset.create({
  data: {
    jobId: job.id,
    type: AssetType.VIDEO,
  },
});

// 4️⃣ Create asset version
const assetVersion = await prisma.assetVersion.create({
  data: {
    assetId: asset.id,
    version: 1,
    fileUrl: 'https://cdn.neura.ai/videos/sample.mp4',
    width: 1024,
    height: 576,
    quality: 'HD',
    metadata: {
      fps: 30,
      duration: 6,
    },
  },
});

console.log('✅ Created asset + version');

// 5️⃣ Gallery item
await prisma.galleryItem.create({
  data: {
    userId: user.id,
    assetVersionId: assetVersion.id,
    isPublic: true,
  },
});
    console.log('✅ Created gallery item');
}
main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
