import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

type AudioProfileId = 'calm' | 'upbeat' | 'dark';
type AmbienceProfileId = 'rain' | 'ocean' | 'city' | 'wind' | 'forest' | 'night';

type AudioProfile = {
  id: AudioProfileId;
  frequencies: [number, number, number];
  lowpassHz: number;
  modulationHz: number;
  modulationDepth: number;
  echoMs: number;
  volume: number;
};

type AmbienceProfile = {
  id: AmbienceProfileId;
  source: string;
  filter: string;
  volume: number;
};

const AUDIO_PROFILES: AudioProfile[] = [
  {
    id: 'calm',
    frequencies: [220.0, 261.63, 329.63],
    lowpassHz: 1300,
    modulationHz: 0.8,
    modulationDepth: 0.18,
    echoMs: 42,
    volume: 0.08,
  },
  {
    id: 'upbeat',
    frequencies: [261.63, 329.63, 392.0],
    lowpassHz: 1800,
    modulationHz: 2.4,
    modulationDepth: 0.26,
    echoMs: 26,
    volume: 0.09,
  },
  {
    id: 'dark',
    frequencies: [110.0, 164.81, 220.0],
    lowpassHz: 1100,
    modulationHz: 0.55,
    modulationDepth: 0.2,
    echoMs: 64,
    volume: 0.07,
  },
];

const KEYWORD_TO_PROFILE: Array<{ keywords: string[]; profileId: AudioProfileId }> = [
  {
    profileId: 'upbeat',
    keywords: [
      'happy',
      'fun',
      'party',
      'dance',
      'sport',
      'action',
      'energetic',
      'sunny',
      'vui',
      'sôi động',
      'năng lượng',
    ],
  },
  {
    profileId: 'dark',
    keywords: [
      'dark',
      'night',
      'horror',
      'mystery',
      'tense',
      'dramatic',
      'sad',
      'buồn',
      'kinh dị',
      'bí ẩn',
      'căng thẳng',
    ],
  },
];

const AMBIENCE_PROFILES: Record<AmbienceProfileId, AmbienceProfile> = {
  rain: {
    id: 'rain',
    source: 'anoisesrc=color=blue:amplitude=0.30:sample_rate=44100:d=60',
    filter: 'highpass=f=180,lowpass=f=3600',
    volume: 0.18,
  },
  ocean: {
    id: 'ocean',
    source: 'anoisesrc=color=pink:amplitude=0.25:sample_rate=44100:d=60',
    filter: 'highpass=f=70,lowpass=f=900',
    volume: 0.2,
  },
  city: {
    id: 'city',
    source: 'anoisesrc=color=white:amplitude=0.23:sample_rate=44100:d=60',
    filter: 'highpass=f=220,lowpass=f=4200',
    volume: 0.16,
  },
  wind: {
    id: 'wind',
    source: 'anoisesrc=color=violet:amplitude=0.24:sample_rate=44100:d=60',
    filter: 'highpass=f=90,lowpass=f=1900',
    volume: 0.17,
  },
  forest: {
    id: 'forest',
    source: 'anoisesrc=color=pink:amplitude=0.18:sample_rate=44100:d=60',
    filter: 'highpass=f=120,lowpass=f=2400',
    volume: 0.15,
  },
  night: {
    id: 'night',
    source: 'anoisesrc=color=brown:amplitude=0.16:sample_rate=44100:d=60',
    filter: 'highpass=f=100,lowpass=f=1500',
    volume: 0.14,
  },
};

const KEYWORD_TO_AMBIENCE: Array<{ keywords: string[]; ambienceId: AmbienceProfileId }> = [
  {
    ambienceId: 'rain',
    keywords: ['rain', 'storm', 'wet', 'mưa', 'giông', 'sấm'],
  },
  {
    ambienceId: 'ocean',
    keywords: ['sea', 'ocean', 'beach', 'wave', 'biển', 'bãi biển', 'sóng'],
  },
  {
    ambienceId: 'city',
    keywords: ['city', 'street', 'traffic', 'urban', 'đô thị', 'thành phố', 'đường phố'],
  },
  {
    ambienceId: 'wind',
    keywords: ['wind', 'mountain', 'desert', 'gió', 'núi', 'sa mạc'],
  },
  {
    ambienceId: 'forest',
    keywords: ['forest', 'jungle', 'nature', 'garden', 'rừng', 'thiên nhiên'],
  },
  {
    ambienceId: 'night',
    keywords: ['night', 'moon', 'dark', 'mystery', 'đêm', 'tối', 'bí ẩn'],
  },
];

function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegBinary = ffmpegPath;
  if (!ffmpegBinary) {
    throw new Error('ffmpeg binary not found');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary, args, { stdio: 'pipe' });
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

function pickProfile(prompt?: string, seed?: string): AudioProfile {
  const normalizedPrompt = (prompt ?? '').toLowerCase();

  for (const entry of KEYWORD_TO_PROFILE) {
    if (entry.keywords.some((keyword) => normalizedPrompt.includes(keyword))) {
      return AUDIO_PROFILES.find((profile) => profile.id === entry.profileId)!;
    }
  }

  const source = seed || normalizedPrompt || 'default-audio-profile';
  const hash = crypto.createHash('sha1').update(source).digest();
  const index = hash[0] % AUDIO_PROFILES.length;
  return AUDIO_PROFILES[index];
}

function pickAmbience(
  prompt: string | undefined,
  seed: string | undefined,
  profileId: AudioProfileId,
): AmbienceProfile {
  const normalizedPrompt = (prompt ?? '').toLowerCase();

  for (const entry of KEYWORD_TO_AMBIENCE) {
    if (entry.keywords.some((keyword) => normalizedPrompt.includes(keyword))) {
      return AMBIENCE_PROFILES[entry.ambienceId];
    }
  }

  const fallbackByMusicProfile: Record<AudioProfileId, AmbienceProfileId> = {
    calm: 'forest',
    upbeat: 'city',
    dark: 'night',
  };

  const source = seed || normalizedPrompt || 'default-ambience-profile';
  const hash = crypto.createHash('sha1').update(source).digest();
  const randomAmbienceIndex = hash[1] % (Object.keys(AMBIENCE_PROFILES).length || 1);
  const randomAmbienceId = Object.keys(AMBIENCE_PROFILES)[randomAmbienceIndex] as AmbienceProfileId;

  const preferredAmbienceId =
    normalizedPrompt.length > 0
      ? fallbackByMusicProfile[profileId]
      : randomAmbienceId;
  return AMBIENCE_PROFILES[preferredAmbienceId];
}

export async function addBackgroundAudioToVideoBuffer(
  videoBuffer: Buffer,
  options?: {
    prompt?: string;
    seed?: string;
  },
): Promise<Buffer> {
  const tempDir = path.join(os.tmpdir(), 'neuragen-video-audio');
  await fs.mkdir(tempDir, { recursive: true });

  const fileId = crypto.randomUUID();
  const inputPath = path.join(tempDir, `${fileId}.mp4`);
  const outputPath = path.join(tempDir, `${fileId}.with-audio.mp4`);
  const profile = pickProfile(options?.prompt, options?.seed);
  const ambience = pickAmbience(options?.prompt, options?.seed, profile.id);

  try {
    await fs.writeFile(inputPath, videoBuffer);

    const harmonicInputs = profile.frequencies.map((frequency) => (
      `sine=frequency=${frequency}:sample_rate=44100:duration=60`
    ));
    const sourceInputs = [...harmonicInputs, ambience.source];
    const sourceArgs = sourceInputs.flatMap((source) => ['-f', 'lavfi', '-i', source]);

    const harmonicLabels = harmonicInputs.map((_, index) => `[${index + 1}:a]`).join('');
    const ambienceLabel = `[${harmonicInputs.length + 1}:a]`;

    const musicBus = `${harmonicLabels}amix=inputs=${harmonicInputs.length}:normalize=0,highpass=f=80,lowpass=f=${profile.lowpassHz},tremolo=f=${profile.modulationHz}:d=${profile.modulationDepth},aecho=0.8:0.4:${profile.echoMs}:0.14,volume=${profile.volume}[music]`;
    const ambienceBus = `${ambienceLabel}${ambience.filter},volume=${ambience.volume}[amb]`;
    const finalMix = '[music][amb]amix=inputs=2:normalize=0,alimiter=limit=0.9:level=disabled,volume=1[a]';

    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      ...sourceArgs,
      '-filter_complex',
      `${musicBus};${ambienceBus};${finalMix}`,
      '-map',
      '0:v:0',
      '-map',
      '[a]',
      '-shortest',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath,
    ]);

    return await fs.readFile(outputPath);
  } finally {
    await Promise.allSettled([
      fs.unlink(inputPath),
      fs.unlink(outputPath),
    ]);
  }
}
