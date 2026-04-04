import { BadRequestException } from '@nestjs/common';

export type VideoGenerationProvider = 'modal';
export type VideoGenerationWorkflow = 'I2V' | 'TI2V';
export type VideoGenerationTier = 'preview' | 'standard' | 'quality' | 'turbo';
export type VideoGenerationPresetId =
  | 'preview_ltx_i2v'
  | 'turbo_wan22_i2v_a14b'
  | 'standard_wan22_ti2v'
  | 'quality_hunyuan_i2v';

export interface VideoGenerationPreset {
  id: VideoGenerationPresetId;
  label: string;
  tier: VideoGenerationTier;
  provider: VideoGenerationProvider;
  workflow: VideoGenerationWorkflow;
  modelName: string;
  turboEnabled: boolean;
  creditCost: number;
  estimatedDurationSeconds: number;
  requiresExplicitSelection: boolean;
}

export const DEFAULT_VIDEO_PRESET_ID: VideoGenerationPresetId = 'standard_wan22_ti2v';

export const VIDEO_GENERATION_PRESETS: Record<
  VideoGenerationPresetId,
  VideoGenerationPreset
> = {
  preview_ltx_i2v: {
    id: 'preview_ltx_i2v',
    label: 'LTX-Video Preview I2V',
    tier: 'preview',
    provider: 'modal',
    workflow: 'I2V',
    modelName: 'ltx-video-i2v-preview',
    turboEnabled: false,
    creditCost: 5,
    estimatedDurationSeconds: 300,
    requiresExplicitSelection: true,
  },
  turbo_wan22_i2v_a14b: {
    id: 'turbo_wan22_i2v_a14b',
    label: 'Turbo Wan 2.2 I2V A14B',
    tier: 'turbo',
    provider: 'modal',
    workflow: 'I2V',
    modelName: 'wan2.2-i2v-a14b-turbo',
    turboEnabled: true,
    creditCost: 15,
    estimatedDurationSeconds: 240,
    requiresExplicitSelection: true,
  },
  standard_wan22_ti2v: {
    id: 'standard_wan22_ti2v',
    label: 'Wan 2.2 Standard TI2V',
    tier: 'standard',
    provider: 'modal',
    workflow: 'TI2V',
    modelName: 'wan2.2-ti2v-standard',
    turboEnabled: false,
    creditCost: 10,
    estimatedDurationSeconds: 420,
    requiresExplicitSelection: false,
  },
  quality_hunyuan_i2v: {
    id: 'quality_hunyuan_i2v',
    label: 'Hunyuan Video Quality I2V',
    tier: 'quality',
    provider: 'modal',
    workflow: 'I2V',
    modelName: 'hunyuan-video-i2v-quality',
    turboEnabled: false,
    creditCost: 20,
    estimatedDurationSeconds: 1320,
    requiresExplicitSelection: true,
  },
};

export function resolveVideoPreset(
  presetId?: string,
): VideoGenerationPreset {
  const resolvedId = (presetId ?? DEFAULT_VIDEO_PRESET_ID) as VideoGenerationPresetId;
  const preset = VIDEO_GENERATION_PRESETS[resolvedId];

  if (!preset) {
    throw new BadRequestException(`Unsupported video preset: ${presetId}`);
  }

  return preset;
}
