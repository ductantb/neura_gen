import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const LTX_PREVIEW_MODEL_NAME = 'ltx-video-i2v-preview';
const LTX_PREVIEW_PRESET_ID = 'preview_ltx_i2v';
const WAN_STANDARD_MODEL_NAME = 'wan2.2-i2v-standard';
const WAN_STANDARD_PRESET_ID = 'standard_wan22_i2v';
const HUNYUAN_QUALITY_MODEL_NAME = 'hunyuan-video-i2v-quality';
const HUNYUAN_QUALITY_PRESET_ID = 'quality_hunyuan_i2v';

@Injectable()
export class ModalService {
  constructor(private readonly http: HttpService) {}

  private getRequiredEnv(name: string) {
    const url = process.env[name];
    if (!url) {
      throw new InternalServerErrorException(`${name} is missing`);
    }

    return url;
  }

  private resolveGenerateUrl(payload: GenerateVideoInput) {
    if (
      payload.presetId === WAN_STANDARD_PRESET_ID ||
      payload.modelName === WAN_STANDARD_MODEL_NAME
    ) {
      return this.getRequiredEnv('MODAL_GENERATE_VIDEO_WAN_URL');
    }

    if (
      payload.presetId === HUNYUAN_QUALITY_PRESET_ID ||
      payload.modelName === HUNYUAN_QUALITY_MODEL_NAME
    ) {
      return this.getRequiredEnv('MODAL_GENERATE_VIDEO_HUNYUAN_URL');
    }

    if (
      payload.presetId === undefined &&
      payload.modelName === undefined
    ) {
      return this.getRequiredEnv('MODAL_GENERATE_VIDEO_URL');
    }

    if (
      payload.presetId === LTX_PREVIEW_PRESET_ID ||
      payload.modelName === LTX_PREVIEW_MODEL_NAME
    ) {
      return this.getRequiredEnv('MODAL_GENERATE_VIDEO_URL');
    }

    throw new InternalServerErrorException(
      `No Modal route configured for preset "${payload.presetId ?? 'unknown'}" and model "${payload.modelName ?? 'unknown'}"`,
    );
  }

  private resolveTimeoutMs(payload: GenerateVideoInput) {
    if (
      payload.presetId === WAN_STANDARD_PRESET_ID ||
      payload.modelName === WAN_STANDARD_MODEL_NAME
    ) {
      return 45 * 60 * 1000;
    }

    return 10 * 60 * 1000;
  }

  async generateVideo(payload: GenerateVideoInput) {
    try {
      const generateUrl = this.resolveGenerateUrl(payload);
      console.log('Modal payload:', JSON.stringify(payload, null, 2));
      const res = await firstValueFrom(
        this.http.post(generateUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.resolveTimeoutMs(payload),
        }),
      );
      console.log('Modal API Response Status:', res.status);
      console.log('Modal API Response Headers:', JSON.stringify(res.headers, null, 2));
      console.log('Modal API Response Data:', JSON.stringify(res.data, null, 2));
      return res.data;
    } catch (error) {
      console.error('Modal API Error:', error);
      throw error;
    }
  }

  // async getVideoBuffer(modalRes: any): Promise<Buffer> {
  //   console.log('getVideoBuffer input type:', typeof modalRes);
  //   console.log('getVideoBuffer input keys:', Object.keys(modalRes || {}));
  //   console.log('getVideoBuffer full input:', JSON.stringify(modalRes, null, 2));
    
  //   // Try base64 encoding
  //   if (modalRes?.video_base64) {
  //     console.log('Found video_base64, converting to buffer...');
  //     const buffer = Buffer.from(modalRes.video_base64, 'base64');
  //     console.log('Buffer size:', buffer.length, 'bytes');
  //     return buffer;
  //   }
    
  //   // Try video URL
  //   if (modalRes?.video_url) {
  //     console.log('Found video_url, downloading from:', modalRes.video_url);
  //     try {
  //       const dl = await firstValueFrom(
  //         this.http.get(modalRes.video_url, {
  //           responseType: 'arraybuffer',
  //           timeout: 10 * 60 * 1000,
  //         }),
  //       );
  //       const buffer = Buffer.from(dl.data);
  //       console.log('Downloaded buffer size:', buffer.length, 'bytes');
  //       return buffer;
  //     } catch (downloadError) {
  //       console.error('Error downloading video from URL:', downloadError);
  //       throw downloadError;
  //     }
  //   }
    
  //   // Fallback: check for nested data property
  //   if (modalRes?.data?.video_base64) {
  //     console.log('Found video_base64 in nested data, converting to buffer...');
  //     return Buffer.from(modalRes.data.video_base64, 'base64');
  //   }
    
  //   if (modalRes?.data?.video_url) {
  //     console.log('Found video_url in nested data, downloading from:', modalRes.data.video_url);
  //     const dl = await firstValueFrom(
  //       this.http.get(modalRes.data.video_url, {
  //         responseType: 'arraybuffer',
  //         timeout: 10 * 60 * 1000,
  //       }),
  //     );
  //     return Buffer.from(dl.data);
  //   }
    
  //   const availableKeys = Object.keys(modalRes || {}).join(', ');

  //   // Special case: Modal function run response (ack only) that needs post-processing
  //   if (modalRes?.status === 'ok' && !modalRes?.video_url && !modalRes?.video_base64 && !modalRes?.data?.video_url && !modalRes?.data?.video_base64) {
  //     const message = `Modal returned successful status but no video payload yet. You may be calling an initial job API; with this backend you need to poll for final output URL/stream or use the correct "result" endpoint.`;
  //     const errorMsg = `${message} Response keys: ${availableKeys}, body: ${JSON.stringify(modalRes)}`;
  //     console.error(errorMsg);
  //     throw new Error(errorMsg);
  //   }

  //   const errorMsg = `Modal returned no video. Response structure: ${availableKeys} | Full response: ${JSON.stringify(modalRes)}`;
  //   console.error(errorMsg);
  //   throw new Error(errorMsg);
  // }

    async getVideoBuffer(modalRes: any): Promise<Buffer> {
    const videoBase64 =
      modalRes?.video_base64 ??
      modalRes?.result?.video_base64 ??
      modalRes?.output?.video_base64 ??
      modalRes?.data?.video_base64;

    const videoUrl =
      modalRes?.video_url ??
      modalRes?.result?.video_url ??
      modalRes?.output?.video_url ??
      modalRes?.data?.video_url ??
      modalRes?.result?.url ??
      modalRes?.output?.url ??
      modalRes?.data?.url;

    if (videoBase64) {
      return Buffer.from(videoBase64, 'base64');
    }

    if (videoUrl) {
      const dl = await firstValueFrom(
        this.http.get(videoUrl, {
          responseType: 'arraybuffer',
          timeout: 10 * 60 * 1000,
        }),
      );
      return Buffer.from(dl.data);
    }

    throw new Error(
      `Modal returned no video. Full response: ${JSON.stringify(modalRes)}`
    );
  }

  // test function to call modal api with hardcoded prompt and image
  // async smokeTest() {
  //   return await this.generateVideo({ prompt: 'smoke test' });
  // }
}

export interface GenerateVideoInput {
  prompt: string;
  negativePrompt?: string;
  inputImageUrl: string;
  jobId?: string;
  provider?: string;
  modelName?: string;
  presetId?: string;
  userId?: string;
  workflow?: string;
}
