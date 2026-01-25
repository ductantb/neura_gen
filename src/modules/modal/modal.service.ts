import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ModalService {
  constructor(private readonly http: HttpService) {}

  async smokeTest() {
    const url = process.env.MODAL_GENERATE_VIDEO_URL;

    if (!url || !/^https?:\/\//.test(url)) {
      throw new InternalServerErrorException({
        message: 'MODAL_GENERATE_VIDEO_URL is missing or invalid',
        got: url ?? null,
        expectedExample:
          'https://<username>--neura-video-gen.modal.run/generate_video',
      });
    }

    const payload = { prompt: 'smoke-test', user_id: 'nest' };

    const res = await firstValueFrom(
      this.http.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60_000,
      }),
    );

    return res.data;
  }
}
