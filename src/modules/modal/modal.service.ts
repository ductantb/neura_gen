import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ModalService {
  constructor(private readonly http: HttpService) {}

  private get generateUrl() {
    const url = process.env.MODAL_GENERATE_VIDEO_URL;
    if (!url) {
      throw new InternalServerErrorException('MODAL_GENERATE_VIDEO_URL is missing');
    }
    return url;
  }

  async generateVideo(payload: GenerateVideoInput) {
    try {
      console.log('Modal payload:', JSON.stringify(payload, null, 2));
      const res = await firstValueFrom(
        this.http.post(this.generateUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10 * 60 * 1000,
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
  modelName?: string;
  userId?: string;
}