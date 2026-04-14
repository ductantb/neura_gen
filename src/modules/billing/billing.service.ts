import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreditReason,
  PaymentOrderStatus,
  PaymentOrderType,
  PaymentProvider,
  Prisma,
  UserRole,
} from '@prisma/client';
import axios from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import {
  CREDIT_TOPUP_PACKAGES,
  PRO_PLAN_PACKAGE,
  resolvePackage,
} from './billing.catalog';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { MarkPaymentPaidDto } from './dto/mark-payment-paid.dto';
import {
  PRO_DAILY_FREE_PREMIUM_CREDITS,
  PRO_ONLY_VIDEO_PRESET_IDS,
} from '../jobs/video-generation.catalog';

type MomoConfig = {
  endpoint: string;
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  redirectUrl: string;
  ipnUrl: string;
  partnerName: string;
  storeId: string;
  requestType: string;
  lang: 'vi' | 'en';
  autoCapture: boolean;
};

type MomoCreatePaymentResponse = {
  requestId: string;
  orderId: string;
  amount: number;
  responseTime: number;
  resultCode: number;
  message: string;
  payUrl?: string;
  shortLink?: string;
  deeplink?: string;
  qrCodeUrl?: string;
};

type MomoIpnPayload = {
  orderType: string;
  amount: number;
  partnerCode: string;
  orderId: string;
  extraData: string;
  signature: string;
  transId: number;
  responseTime: number;
  resultCode: number;
  message: string;
  payType: string;
  requestId: string;
  orderInfo: string;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getCatalog() {
    return {
      proPlan: {
        ...PRO_PLAN_PACKAGE,
        dailyFreePremiumCredits: PRO_DAILY_FREE_PREMIUM_CREDITS,
        proOnlyPresets: PRO_ONLY_VIDEO_PRESET_IDS,
      },
      creditTopupPackages: CREDIT_TOPUP_PACKAGES,
    };
  }

  async createOrder(userId: string, dto: CreatePaymentOrderDto) {
    const resolved = resolvePackage(dto.type, dto.packageCode);

    if (!resolved) {
      throw new BadRequestException('Invalid billing package for this order type');
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const order = await this.prisma.paymentOrder.create({
      data: {
        userId,
        provider: dto.provider,
        type: dto.type,
        packageCode: resolved.packageCode,
        amountUsd: resolved.amountUsd,
        creditAmount: resolved.creditAmount,
        proDurationDays: resolved.proDurationDays,
        expiresAt,
        metadata: {
          amountVnd: resolved.amountVnd,
          integrationStatus: 'created',
        },
      },
      select: {
        id: true,
        userId: true,
        provider: true,
        type: true,
        status: true,
        packageCode: true,
        amountUsd: true,
        creditAmount: true,
        proDurationDays: true,
        createdAt: true,
        expiresAt: true,
        metadata: true,
      },
    });

    if (dto.provider !== PaymentProvider.MOMO) {
      return {
        ...order,
        amountVnd: resolved.amountVnd,
        note:
          'Order created. Đối với BANK_TRANSFER, hãy đối soát và dùng endpoint mark-paid hoặc webhook ngân hàng để xác nhận.',
      };
    }

    const momoResponse = await this.createMomoPayment(order, resolved.amountVnd);

    if (momoResponse.resultCode !== 0 || !momoResponse.payUrl) {
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: PaymentOrderStatus.FAILED,
          metadata: {
            ...this.asObject(order.metadata),
            momo: momoResponse,
            integrationStatus: 'momo_create_failed',
          },
        },
      });

      throw new BadRequestException(
        `MoMo create payment failed: ${momoResponse.message} (code ${momoResponse.resultCode})`,
      );
    }

    const updatedOrder = await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        metadata: {
          ...this.asObject(order.metadata),
          momo: momoResponse,
          integrationStatus: 'momo_pay_url_created',
        },
      },
      select: {
        id: true,
        provider: true,
        type: true,
        status: true,
        packageCode: true,
        amountUsd: true,
        creditAmount: true,
        proDurationDays: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return {
      ...updatedOrder,
      amountVnd: resolved.amountVnd,
      payUrl: momoResponse.payUrl,
      shortLink: momoResponse.shortLink ?? null,
      deeplink: momoResponse.deeplink ?? null,
      qrCodeUrl: momoResponse.qrCodeUrl ?? null,
      note: 'MoMo payment link created successfully.',
    };
  }

  async listMyOrders(userId: string) {
    return this.prisma.paymentOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        provider: true,
        type: true,
        status: true,
        packageCode: true,
        amountUsd: true,
        creditAmount: true,
        proDurationDays: true,
        providerOrderId: true,
        paidAt: true,
        createdAt: true,
        expiresAt: true,
        metadata: true,
      },
    });
  }

  async markOrderPaid(orderId: string, dto: MarkPaymentPaidDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findUnique({
        where: { id: orderId },
        include: {
          user: {
            select: {
              id: true,
              role: true,
              proExpiresAt: true,
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException('Payment order not found');
      }

      if (order.status === PaymentOrderStatus.PAID) {
        return {
          orderId: order.id,
          status: order.status,
          message: 'Order already marked as paid',
        };
      }

      if (order.status !== PaymentOrderStatus.PENDING) {
        throw new BadRequestException('Only pending orders can be marked as paid');
      }

      if (dto.providerOrderId) {
        const existingProviderOrder = await tx.paymentOrder.findFirst({
          where: {
            providerOrderId: dto.providerOrderId,
            id: {
              not: order.id,
            },
          },
          select: {
            id: true,
          },
        });

        if (existingProviderOrder) {
          throw new BadRequestException('providerOrderId already used by another order');
        }
      }

      const claimResult = await tx.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: PaymentOrderStatus.PENDING,
        },
        data: {
          status: PaymentOrderStatus.PAID,
          paidAt: new Date(),
          providerOrderId: dto.providerOrderId ?? order.providerOrderId,
        },
      });

      if (claimResult.count === 0) {
        return {
          orderId: order.id,
          status: PaymentOrderStatus.PAID,
          message: 'Order already marked as paid',
        };
      }

      let nextProExpiresAt: Date | null = order.user.proExpiresAt;

      if (order.creditAmount > 0) {
        await tx.userCredit.upsert({
          where: { userId: order.userId },
          update: {
            balance: {
              increment: order.creditAmount,
            },
          },
          create: {
            userId: order.userId,
            balance: order.creditAmount,
          },
        });
      }

      if (order.type === PaymentOrderType.PRO_SUBSCRIPTION) {
        const baseStart =
          order.user.proExpiresAt && order.user.proExpiresAt.getTime() > Date.now()
            ? order.user.proExpiresAt
            : new Date();

        nextProExpiresAt = new Date(
          baseStart.getTime() + order.proDurationDays * 24 * 60 * 60 * 1000,
        );

        await tx.user.update({
          where: { id: order.userId },
          data: {
            role: UserRole.PRO,
            proExpiresAt: nextProExpiresAt,
          },
        });
      }

      if (order.creditAmount > 0) {
        await tx.creditTransaction.create({
          data: {
            userId: order.userId,
            amount: order.creditAmount,
            reason:
              order.type === PaymentOrderType.PRO_SUBSCRIPTION
                ? CreditReason.PURCHASE_PRO_SUBSCRIPTION
                : CreditReason.PURCHASE_TOPUP,
            metadata: {
              paymentOrderId: order.id,
              provider: order.provider,
              providerOrderId: dto.providerOrderId ?? null,
              packageCode: order.packageCode,
            },
          },
        });
      }

      const paidOrder = await tx.paymentOrder.findUnique({
        where: { id: order.id },
        select: {
          id: true,
          status: true,
          type: true,
          packageCode: true,
          amountUsd: true,
          creditAmount: true,
          proDurationDays: true,
          providerOrderId: true,
          paidAt: true,
        },
      });

      if (!paidOrder) {
        throw new NotFoundException('Payment order not found after marking paid');
      }

      return {
        ...paidOrder,
        nextProExpiresAt,
      };
    });
  }

  async handleMomoIpn(rawPayload: Record<string, unknown>) {
    const config = this.getMomoConfig();
    const payload = this.parseMomoIpnPayload(rawPayload);

    if (!payload) {
      this.logger.warn('Received malformed MoMo IPN payload');
      return;
    }

    if (payload.partnerCode !== config.partnerCode) {
      this.logger.warn(
        `Ignored MoMo IPN due to partnerCode mismatch: ${payload.partnerCode}`,
      );
      return;
    }

    const isValid = this.verifyMomoIpnSignature(payload, config);
    if (!isValid) {
      this.logger.warn(`Ignored MoMo IPN due to invalid signature. orderId=${payload.orderId}`);
      return;
    }

    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: payload.orderId },
      select: {
        id: true,
        status: true,
        provider: true,
        metadata: true,
      },
    });

    if (!order) {
      this.logger.warn(`Ignored MoMo IPN due to unknown orderId=${payload.orderId}`);
      return;
    }

    if (order.provider !== PaymentProvider.MOMO) {
      this.logger.warn(`Ignored MoMo IPN because order provider is not MOMO. orderId=${order.id}`);
      return;
    }

    const expectedAmount = this.extractAmountVnd(order.metadata);
    if (expectedAmount !== null && expectedAmount !== payload.amount) {
      this.logger.warn(
        `Ignored MoMo IPN due to amount mismatch. orderId=${order.id}, expected=${expectedAmount}, actual=${payload.amount}`,
      );
      return;
    }

    const updatedMetadata = {
      ...this.asObject(order.metadata),
      momoLastIpn: {
        ...payload,
        receivedAt: new Date().toISOString(),
      },
    };

    if (payload.resultCode === 0) {
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          metadata: {
            ...updatedMetadata,
            integrationStatus: 'momo_ipn_success_received',
          },
        },
      });

      await this.markOrderPaid(order.id, {
        providerOrderId: String(payload.transId),
      });

      return;
    }

    if (order.status === PaymentOrderStatus.PENDING) {
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: PaymentOrderStatus.FAILED,
          metadata: {
            ...updatedMetadata,
            integrationStatus: 'momo_ipn_failed',
          },
        },
      });

      return;
    }

    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        metadata: updatedMetadata,
      },
    });
  }

  private async createMomoPayment(
    order: {
      id: string;
      userId: string;
      type: PaymentOrderType;
      packageCode: string;
    },
    amountVnd: number,
  ): Promise<MomoCreatePaymentResponse> {
    const config = this.getMomoConfig();
    const requestId = order.id;
    const orderId = order.id;
    const orderInfo =
      order.type === PaymentOrderType.PRO_SUBSCRIPTION
        ? 'Neura Gen PRO subscription'
        : `Neura Gen credit topup ${order.packageCode}`;
    const extraData = Buffer.from(
      JSON.stringify({
        paymentOrderId: order.id,
        userId: order.userId,
        packageCode: order.packageCode,
      }),
      'utf8',
    ).toString('base64');

    const rawSignature = this.buildMomoCreateRawSignature({
      accessKey: config.accessKey,
      amount: amountVnd,
      extraData,
      ipnUrl: config.ipnUrl,
      orderId,
      orderInfo,
      partnerCode: config.partnerCode,
      redirectUrl: config.redirectUrl,
      requestId,
      requestType: config.requestType,
    });

    const signature = this.sign(rawSignature, config.secretKey);

    const payload = {
      partnerCode: config.partnerCode,
      partnerName: config.partnerName,
      storeId: config.storeId,
      requestId,
      amount: amountVnd,
      orderId,
      orderInfo,
      redirectUrl: config.redirectUrl,
      ipnUrl: config.ipnUrl,
      lang: config.lang,
      requestType: config.requestType,
      autoCapture: config.autoCapture,
      extraData,
      signature,
    };

    try {
      const response = await axios.post<MomoCreatePaymentResponse>(
        `${config.endpoint}/v2/gateway/api/create`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      return response.data;
    } catch (error) {
      const message =
        axios.isAxiosError(error) && error.response?.data
          ? JSON.stringify(error.response.data)
          : error instanceof Error
            ? error.message
            : 'Unknown MoMo error';

      throw new BadRequestException(`Failed to create MoMo payment: ${message}`);
    }
  }

  private getMomoConfig(): MomoConfig {
    const endpoint =
      this.configService.get<string>('MOMO_ENDPOINT') ?? 'https://test-payment.momo.vn';
    const partnerCode = this.configService.get<string>('MOMO_PARTNER_CODE');
    const accessKey = this.configService.get<string>('MOMO_ACCESS_KEY');
    const secretKey = this.configService.get<string>('MOMO_SECRET_KEY');
    const redirectUrl = this.configService.get<string>('MOMO_REDIRECT_URL');
    const ipnUrl = this.configService.get<string>('MOMO_IPN_URL');

    if (!partnerCode || !accessKey || !secretKey || !redirectUrl || !ipnUrl) {
      throw new BadRequestException(
        'Missing MoMo configuration. Required: MOMO_PARTNER_CODE, MOMO_ACCESS_KEY, MOMO_SECRET_KEY, MOMO_REDIRECT_URL, MOMO_IPN_URL',
      );
    }

    const requestType = this.configService.get<string>('MOMO_REQUEST_TYPE') ?? 'payWithMethod';
    const partnerName = this.configService.get<string>('MOMO_PARTNER_NAME') ?? 'Neura Gen';
    const storeId = this.configService.get<string>('MOMO_STORE_ID') ?? 'NeuraGen';
    const langRaw = this.configService.get<string>('MOMO_LANG') ?? 'vi';
    const lang: 'vi' | 'en' = langRaw === 'en' ? 'en' : 'vi';
    const autoCaptureRaw =
      (this.configService.get<string>('MOMO_AUTO_CAPTURE') ?? 'true').toLowerCase();

    return {
      endpoint,
      partnerCode,
      accessKey,
      secretKey,
      redirectUrl,
      ipnUrl,
      partnerName,
      storeId,
      requestType,
      lang,
      autoCapture: autoCaptureRaw !== 'false',
    };
  }

  private parseMomoIpnPayload(payload: Record<string, unknown>): MomoIpnPayload | null {
    const amount = Number(payload.amount);
    const transId = Number(payload.transId);
    const responseTime = Number(payload.responseTime);
    const resultCode = Number(payload.resultCode);

    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(transId) ||
      !Number.isFinite(responseTime) ||
      !Number.isFinite(resultCode)
    ) {
      return null;
    }

    const signature = this.asString(payload.signature);
    const partnerCode = this.asString(payload.partnerCode);
    const orderId = this.asString(payload.orderId);
    const requestId = this.asString(payload.requestId);

    if (!signature || !partnerCode || !orderId || !requestId) {
      return null;
    }

    return {
      orderType: this.asString(payload.orderType) ?? '',
      amount,
      partnerCode,
      orderId,
      extraData: this.asString(payload.extraData) ?? '',
      signature,
      transId,
      responseTime,
      resultCode,
      message: this.asString(payload.message) ?? '',
      payType: this.asString(payload.payType) ?? '',
      requestId,
      orderInfo: this.asString(payload.orderInfo) ?? '',
    };
  }

  private verifyMomoIpnSignature(payload: MomoIpnPayload, config: MomoConfig): boolean {
    const rawSignature =
      `accessKey=${config.accessKey}` +
      `&amount=${payload.amount}` +
      `&extraData=${payload.extraData}` +
      `&message=${payload.message}` +
      `&orderId=${payload.orderId}` +
      `&orderInfo=${payload.orderInfo}` +
      `&orderType=${payload.orderType}` +
      `&partnerCode=${payload.partnerCode}` +
      `&payType=${payload.payType}` +
      `&requestId=${payload.requestId}` +
      `&responseTime=${payload.responseTime}` +
      `&resultCode=${payload.resultCode}` +
      `&transId=${payload.transId}`;

    const expected = this.sign(rawSignature, config.secretKey);

    return this.safeCompare(expected, payload.signature);
  }

  private buildMomoCreateRawSignature(input: {
    accessKey: string;
    amount: number;
    extraData: string;
    ipnUrl: string;
    orderId: string;
    orderInfo: string;
    partnerCode: string;
    redirectUrl: string;
    requestId: string;
    requestType: string;
  }) {
    return (
      `accessKey=${input.accessKey}` +
      `&amount=${input.amount}` +
      `&extraData=${input.extraData}` +
      `&ipnUrl=${input.ipnUrl}` +
      `&orderId=${input.orderId}` +
      `&orderInfo=${input.orderInfo}` +
      `&partnerCode=${input.partnerCode}` +
      `&redirectUrl=${input.redirectUrl}` +
      `&requestId=${input.requestId}` +
      `&requestType=${input.requestType}`
    );
  }

  private sign(data: string, secretKey: string): string {
    return createHmac('sha256', secretKey).update(data).digest('hex');
  }

  private safeCompare(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private asObject(metadata: Prisma.JsonValue | null): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return metadata as Record<string, unknown>;
  }

  private extractAmountVnd(metadata: Prisma.JsonValue | null): number | null {
    const source = this.asObject(metadata).amountVnd;
    const amountVnd = Number(source);

    return Number.isFinite(amountVnd) ? amountVnd : null;
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }
}
