import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'pipe' });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

export async function generateThumbnailFromVideoBuffer(
  videoBuffer: Buffer,
): Promise<Buffer> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not found');
  }

  const tempDir = path.join(os.tmpdir(), 'neuragen-thumbnails');
  await fs.mkdir(tempDir, { recursive: true });

  const fileId = crypto.randomUUID();
  const inputPath = path.join(tempDir, `${fileId}.mp4`);
  const outputPath = path.join(tempDir, `${fileId}.jpg`);

  try {
    await fs.writeFile(inputPath, videoBuffer);

    await runCommand(ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-ss',
      '00:00:01.000',
      '-vframes',
      '1',
      '-q:v',
      '2',
      outputPath,
    ]);

    const thumbnailBuffer = await fs.readFile(outputPath);
    return thumbnailBuffer;
  } finally {
    await Promise.allSettled([
      fs.unlink(inputPath),
      fs.unlink(outputPath),
    ]);
  }
}