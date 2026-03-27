import { BadRequestException } from '@nestjs/common';

export type VideoGenerationProvider = 'modal';
export type VideoGenerationWorkflow = 'I2V';
export type VideoGenerationPresetId =
  | 'preview_ltx_i2v'
  | 'standard_wan22_i2v'
  | 'quality_hunyuan_i2v';

export interface VideoGenerationPreset {
  id: VideoGenerationPresetId;
  label: string;
  provider: VideoGenerationProvider;
  workflow: VideoGenerationWorkflow;
  modelName: string;
  turboEnabled: boolean;
}

export const DEFAULT_VIDEO_PRESET_ID: VideoGenerationPresetId = 'standard_wan22_i2v';

export const VIDEO_GENERATION_PRESETS: Record<
  VideoGenerationPresetId,
  VideoGenerationPreset
> = {
  preview_ltx_i2v: {
    id: 'preview_ltx_i2v',
    label: 'LTX-Video Preview I2V',
    provider: 'modal',
    workflow: 'I2V',
    modelName: 'ltx-video-i2v-preview',
    turboEnabled: true,
  },
  standard_wan22_i2v: {
    id: 'standard_wan22_i2v',
    label: 'Wan 2.2 Standard I2V',
    provider: 'modal',
    workflow: 'I2V',
    modelName: 'wan2.2-i2v-standard',
    turboEnabled: false,
  },
  quality_hunyuan_i2v: {
    id: 'quality_hunyuan_i2v',
    label: 'Hunyuan Video Quality I2V',
    provider: 'modal',
    workflow: 'I2V',
    modelName: 'hunyuan-video-i2v-quality',
    turboEnabled: false,
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
