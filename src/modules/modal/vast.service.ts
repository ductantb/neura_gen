import { HttpService } from '@nestjs/axios';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { GenerateVideoInput } from './modal.service';
import { AxiosLikeError, ProviderRequestError } from './provider-error.types';

@Injectable()
export class VastService {
  constructor(private readonly http: HttpService) {}

  private getRequiredEnv(name: string) {
    const value = process.env[name];
    if (!value) {
      throw new InternalServerErrorException(`${name} is missing`);
    }

    return value;
  }

  isEnabled() {
    return (process.env.VAST_ENABLED ?? 'false').toLowerCase() === 'true';
  }

  private resolveTimeoutMs() {
    return Number(process.env.VAST_REQUEST_TIMEOUT_MS ?? 45 * 60 * 1000);
  }

  private isRetryableVastError(statusCode?: number, responseBody?: string) {
    if (statusCode === undefined) {
      return true;
    }

    if (statusCode === 408 || statusCode === 425 || statusCode >= 500) {
      return true;
    }

    if (statusCode === 429) {
      const normalizedBody = (responseBody ?? '').toLowerCase();
      return !normalizedBody.includes('billing cycle spend limit reached');
    }

    return false;
  }

  private resolveErrorType(
    statusCode: number | undefined,
    responseBody: string,
  ): ProviderRequestError['errorType'] {
    const normalized = responseBody.toLowerCase();
    if (
      normalized.includes('out of memory') ||
      normalized.includes('cuda') ||
      normalized.includes('oom')
    ) {
      return 'TRANSIENT_OOM';
    }

    if (statusCode === undefined || statusCode === 408 || statusCode === 425) {
      return 'TRANSIENT_TIMEOUT';
    }

    if (statusCode >= 500 || statusCode === 429) {
      return 'TRANSIENT_INFRA';
    }

    if (statusCode >= 400) {
      return 'PERMANENT_INPUT';
    }

    return 'TRANSIENT_INFRA';
  }

  async healthcheck() {
    if (!this.isEnabled()) {
      return false;
    }

    const healthcheckUrl = process.env.VAST_HEALTHCHECK_URL;
    if (!healthcheckUrl) {
      return true;
    }

    try {
      const res = await firstValueFrom(
        this.http.get(healthcheckUrl, {
          timeout: 5000,
          proxy: false,
        }),
      );
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async generateVideo(payload: GenerateVideoInput) {
    try {
      const generateUrl = this.getRequiredEnv('VAST_GENERATE_VIDEO_WAN_URL');
      const res = await firstValueFrom(
        this.http.post(generateUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.resolveTimeoutMs(),
          proxy: false,
        }),
      );
      return res.data;
    } catch (error) {
      const axiosLikeError = error as AxiosLikeError;
      if (axiosLikeError?.response || axiosLikeError?.isAxiosError) {
        const statusCode = axiosLikeError.response?.status;
        const responseBody =
          typeof axiosLikeError.response?.data === 'string'
            ? axiosLikeError.response.data
            : JSON.stringify(axiosLikeError.response?.data ?? {});
        const message = statusCode
          ? `Vast request failed with status ${statusCode}: ${responseBody}`
          : axiosLikeError.message;
        const vastError = new Error(message) as ProviderRequestError;
        vastError.statusCode = statusCode;
        vastError.responseBody = responseBody;
        vastError.retryable = this.isRetryableVastError(
          statusCode,
          responseBody,
        );
        vastError.errorType = this.resolveErrorType(statusCode, responseBody);
        throw vastError;
      }

      throw error;
    }
  }

  async getVideoBuffer(vastRes: any): Promise<Buffer> {
    const videoBase64 =
      vastRes?.video_base64 ??
      vastRes?.result?.video_base64 ??
      vastRes?.output?.video_base64 ??
      vastRes?.data?.video_base64;

    const videoUrl =
      vastRes?.video_url ??
      vastRes?.result?.video_url ??
      vastRes?.output?.video_url ??
      vastRes?.data?.video_url ??
      vastRes?.result?.url ??
      vastRes?.output?.url ??
      vastRes?.data?.url;

    if (videoBase64) {
      return Buffer.from(videoBase64, 'base64');
    }

    if (videoUrl) {
      const dl = await firstValueFrom(
        this.http.get(videoUrl, {
          responseType: 'arraybuffer',
          timeout: 10 * 60 * 1000,
          proxy: false,
        }),
      );
      return Buffer.from(dl.data);
    }

    throw new Error(
      `Vast returned no video. Full response: ${JSON.stringify(vastRes)}`,
    );
  }
}
