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

  async generateVideo(payload: { prompt: string }) {
    const res = await firstValueFrom(
      this.http.post(this.generateUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10 * 60 * 1000,
      }),
    );
    return res.data;
  }

  async getVideoBuffer(modalRes: any): Promise<Buffer> {
    if (modalRes?.video_base64) {
      return Buffer.from(modalRes.video_base64, 'base64');
    }
    if (modalRes?.video_url) {
      const dl = await firstValueFrom(
        this.http.get(modalRes.video_url, {
          responseType: 'arraybuffer',
          timeout: 10 * 60 * 1000,
        }),
      );
      return Buffer.from(dl.data);
    }
    throw new Error('Modal returned no video');
  }
}