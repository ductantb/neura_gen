import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { JobStatus, AssetType } from '@prisma/client';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';

const prisma = new PrismaService();
const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});


function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function log(jobId: string, message: string) {
  await prisma.jobLog.create({ data: { jobId, message } });
}

async function setStatus(jobId: string, status: JobStatus, progress: number) {
  await prisma.generateJob.update({
    where: { id: jobId },
    data: { status, progress },
  });
}

new Worker(
  'video-gen',
  async (bullJob) => {
    const { jobId } = bullJob.data as { jobId: string };

    const job = await prisma.generateJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;

    await log(jobId, 'Worker started');
    await setStatus(jobId, JobStatus.RUNNING, 5);

    // Call Modal
    await log(jobId, 'Calling Modal...');
    const modalRes = await axios.post(
      process.env.MODAL_GENERATE_VIDEO_URL!,
      { prompt: job.prompt },
      { timeout: 10 * 60 * 1000 },
    );

    await setStatus(jobId, JobStatus.RUNNING, 60);

    // Get video
    let buffer: Buffer;
    if (modalRes.data?.video_base64) {
      buffer = Buffer.from(modalRes.data.video_base64, 'base64');
    } else if (modalRes.data?.video_url) {
      const dl = await axios.get(modalRes.data.video_url, {
        responseType: 'arraybuffer',
      });
      buffer = Buffer.from(dl.data);
    } else {
      throw new Error('Modal returned no video');
    }

    await setStatus(jobId, JobStatus.RUNNING, 80);

    // Save file
    const dir = process.env.ASSET_STORAGE_DIR || 'public/generated';
    ensureDir(dir);

    const fileName = `${jobId}-${crypto.randomBytes(5).toString('hex')}.mp4`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buffer);

    const baseUrl =
      process.env.PUBLIC_ASSET_BASE_URL || 'http://localhost:3000/public';
    const fileUrl = `${baseUrl}/generated/${fileName}`;

    await log(jobId, `Video saved: ${fileUrl}`);

    // Asset + Version
    const asset = await prisma.asset.create({
      data: {
        jobId,
        type: AssetType.VIDEO,
      },
    });

    await prisma.assetVersion.create({
      data: {
        assetId: asset.id,
        version: 1,
        fileUrl,
        metadata: {
          prompt: job.prompt,
          modelName: job.modelName,
        },
      },
    });

    await setStatus(jobId, JobStatus.DONE, 100);
    await log(jobId, 'Job DONE');
  },
  { connection },
);
