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
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
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

type PayosConfig = {
  endpoint: string;
  clientId: string;
  apiKey: string;
  checksumKey: string;
  returnUrl: string;
  cancelUrl: string;
  webhookUrl?: string;
  partnerCode?: string;
};

type PayosPaymentData = {
  bin: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  description: string;
  orderCode: number;
  currency: string;
  paymentLinkId: string;
  status: string;
  checkoutUrl?: string;
  qrCode?: string;
};

type PayosPaymentLookupData = {
  id?: string;
  orderCode: number;
  amount: number;
  amountPaid?: number;
  amountRemaining?: number;
  status: string;
  createdAt?: string;
  canceledAt?: string;
  cancellationReason?: string;
  transactions?: unknown;
};

type PayosApiResponse<T> = {
  code: string;
  desc: string;
  data: T;
  signature?: string;
};

type PayosWebhookEnvelope = {
  code: string;
  desc: string;
  success?: boolean;
  data: PayosWebhookData;
  signature: string;
};

type PayosWebhookData = {
  orderCode: number;
  amount: number;
  description: string;
  accountNumber: string;
  reference?: string;
  transactionDateTime?: string;
  currency?: string;
  paymentLinkId?: string;
  code?: string;
  desc?: string;
  counterAccountBankId?: string;
  counterAccountBankName?: string;
  counterAccountName?: string;
  counterAccountNumber?: string;
  virtualAccountName?: string;
  virtualAccountNumber?: string;
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

    if (dto.provider === PaymentProvider.BANK_TRANSFER) {
      return {
        ...order,
        amountVnd: resolved.amountVnd,
        note:
          'Order created. Đối với BANK_TRANSFER, hãy đối soát và dùng endpoint mark-paid hoặc webhook ngân hàng để xác nhận.',
      };
    }

    if (dto.provider === PaymentProvider.MOMO) {
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

    if (dto.provider === PaymentProvider.PAYOS) {
      const payosResponse = await this.createPayosPayment(
        order,
        resolved.amountVnd,
      );

      const updatedOrder = await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          metadata: {
            ...this.asObject(order.metadata),
            payosOrderCode: payosResponse.data.orderCode,
            payos: payosResponse,
            integrationStatus: 'payos_payment_link_created',
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
        payUrl: payosResponse.data.checkoutUrl ?? null,
        qrCode: payosResponse.data.qrCode ?? null,
        paymentLinkId: payosResponse.data.paymentLinkId,
        orderCode: payosResponse.data.orderCode,
        note: 'payOS payment link created successfully.',
      };
    }

    throw new BadRequestException(`Unsupported payment provider: ${dto.provider}`);
  }

  async listMyOrders(userId: string) {
    const orders = await this.prisma.paymentOrder.findMany({
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

    const pendingPayosOrders = orders.filter(
      (order) =>
        order.provider === PaymentProvider.PAYOS &&
        order.status === PaymentOrderStatus.PENDING,
    );

    if (pendingPayosOrders.length === 0) {
      return orders;
    }

    let hasStatusChanged = false;
    for (const order of pendingPayosOrders.slice(0, 3)) {
      const syncResult = await this.syncPayosOrderStatus(order.id, userId, {
        silent: true,
      });
      if (syncResult?.statusChanged) {
        hasStatusChanged = true;
      }
    }

    if (!hasStatusChanged) {
      return orders;
    }

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

  async syncMyOrder(userId: string, orderId: string) {
    return this.syncPayosOrderStatus(orderId, userId, { silent: false });
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

  async handlePayosWebhook(rawPayload: Record<string, unknown>) {
    const config = this.getPayosConfig();
    const payload = this.parsePayosWebhookEnvelope(rawPayload);

    if (!payload) {
      this.logger.warn('Received malformed payOS webhook payload');
      return;
    }

    const isValid = this.verifyPayosDataSignature(
      payload.data,
      payload.signature,
      config.checksumKey,
    );

    if (!isValid) {
      this.logger.warn(
        `Ignored payOS webhook due to invalid signature. orderCode=${payload.data.orderCode}`,
      );
      return;
    }

    const order = await this.prisma.paymentOrder.findFirst({
      where: {
        provider: PaymentProvider.PAYOS,
        metadata: {
          path: ['payosOrderCode'],
          equals: payload.data.orderCode,
        },
      },
      select: {
        id: true,
        status: true,
        provider: true,
        metadata: true,
      },
    });

    if (!order) {
      this.logger.warn(
        `Ignored payOS webhook due to unknown orderCode=${payload.data.orderCode}`,
      );
      return;
    }

    const expectedAmount = this.extractAmountVnd(order.metadata);
    if (expectedAmount !== null && expectedAmount !== payload.data.amount) {
      this.logger.warn(
        `Ignored payOS webhook due to amount mismatch. orderId=${order.id}, expected=${expectedAmount}, actual=${payload.data.amount}`,
      );
      return;
    }

    const updatedMetadata = {
      ...this.asObject(order.metadata),
      payosLastWebhook: {
        ...payload,
        receivedAt: new Date().toISOString(),
      },
    };

    const isSuccess = payload.code === '00' && (payload.success ?? true);
    if (isSuccess) {
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          metadata: {
            ...updatedMetadata,
            integrationStatus: 'payos_webhook_success_received',
          },
        },
      });

      await this.markOrderPaid(order.id, {
        providerOrderId:
          payload.data.reference ??
          payload.data.paymentLinkId ??
          String(payload.data.orderCode),
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
            integrationStatus: 'payos_webhook_failed',
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

  async confirmPayosWebhook(overrideWebhookUrl?: string) {
    const config = this.getPayosConfig();
    const webhookUrl = overrideWebhookUrl ?? config.webhookUrl;

    if (!webhookUrl) {
      throw new BadRequestException(
        'Missing webhook URL. Provide webhookUrl in request body or set PAYOS_WEBHOOK_URL in env.',
      );
    }

    try {
      const response = await axios.post<PayosApiResponse<{ webhookUrl: string }>>(
        `${config.endpoint}/confirm-webhook`,
        { webhookUrl },
        {
          headers: this.buildPayosHeaders(config),
          timeout: 30000,
        },
      );

      return {
        webhookUrl,
        response: response.data,
      };
    } catch (error) {
      const message =
        axios.isAxiosError(error) && error.response?.data
          ? JSON.stringify(error.response.data)
          : error instanceof Error
            ? error.message
            : 'Unknown payOS error';

      throw new BadRequestException(`Failed to confirm payOS webhook: ${message}`);
    }
  }

  private async syncPayosOrderStatus(
    orderId: string,
    userId: string,
    options: { silent: boolean },
  ): Promise<{
    orderId: string;
    statusChanged: boolean;
    status: PaymentOrderStatus | 'UNKNOWN';
    message: string;
  }> {
    const order = await this.prisma.paymentOrder.findFirst({
      where: {
        id: orderId,
        userId,
      },
      select: {
        id: true,
        userId: true,
        provider: true,
        status: true,
        metadata: true,
        providerOrderId: true,
      },
    });

    if (!order) {
      if (options.silent) {
        return {
          orderId,
          statusChanged: false,
          status: 'UNKNOWN',
          message: 'Order not found',
        };
      }
      throw new NotFoundException('Payment order not found');
    }

    if (order.provider !== PaymentProvider.PAYOS) {
      if (options.silent) {
        return {
          orderId: order.id,
          statusChanged: false,
          status: order.status,
          message: 'Order provider is not PAYOS',
        };
      }
      throw new BadRequestException('Order provider is not PAYOS');
    }

    if (order.status === PaymentOrderStatus.PAID) {
      return {
        orderId: order.id,
        statusChanged: false,
        status: order.status,
        message: 'Order already paid',
      };
    }

    if (order.status !== PaymentOrderStatus.PENDING) {
      return {
        orderId: order.id,
        statusChanged: false,
        status: order.status,
        message: 'Only pending orders can be synced',
      };
    }

    const metadata = this.asObject(order.metadata);
    const paymentRequestId = this.extractPayosPaymentRequestId(order.metadata);

    if (!paymentRequestId) {
      const message = `Cannot sync PAYOS order ${order.id}: missing payosOrderCode/paymentLinkId in metadata`;
      if (!options.silent) {
        throw new BadRequestException(message);
      }
      this.logger.warn(message);
      return {
        orderId: order.id,
        statusChanged: false,
        status: order.status,
        message,
      };
    }

    const config = this.getPayosConfig();
    const paymentInfo = await axios.get<PayosApiResponse<PayosPaymentLookupData>>(
      `${config.endpoint}/v2/payment-requests/${encodeURIComponent(
        String(paymentRequestId),
      )}`,
      {
        headers: this.buildPayosHeaders(config),
        timeout: 30000,
      },
    );

    if (paymentInfo.data.code !== '00') {
      const message = `payOS lookup failed: ${paymentInfo.data.desc} (code ${paymentInfo.data.code})`;
      if (!options.silent) {
        throw new BadRequestException(message);
      }
      this.logger.warn(message);
      return {
        orderId: order.id,
        statusChanged: false,
        status: order.status,
        message,
      };
    }

    if (paymentInfo.data.signature) {
      const signatureValid = this.verifyPayosDataSignature(
        paymentInfo.data.data as unknown as Record<string, unknown>,
        paymentInfo.data.signature,
        config.checksumKey,
      );
      if (!signatureValid) {
        const message = `payOS lookup signature is invalid. orderId=${order.id}`;
        if (!options.silent) {
          throw new BadRequestException(message);
        }
        this.logger.warn(message);
        return {
          orderId: order.id,
          statusChanged: false,
          status: order.status,
          message,
        };
      }
    }

    const lookupData = paymentInfo.data.data;
    const expectedAmount = this.extractAmountVnd(order.metadata);
    if (expectedAmount !== null && lookupData.amount !== expectedAmount) {
      const message = `payOS lookup amount mismatch. orderId=${order.id}, expected=${expectedAmount}, actual=${lookupData.amount}`;
      if (!options.silent) {
        throw new BadRequestException(message);
      }
      this.logger.warn(message);
      return {
        orderId: order.id,
        statusChanged: false,
        status: order.status,
        message,
      };
    }

    const normalizedStatus = (lookupData.status ?? '').toUpperCase();
    const isPaidByStatus = ['PAID', 'SUCCESS', 'COMPLETED'].includes(
      normalizedStatus,
    );
    const isPaidByAmount =
      typeof lookupData.amountPaid === 'number' &&
      lookupData.amount > 0 &&
      lookupData.amountPaid >= lookupData.amount;
    const isPaid = isPaidByStatus || isPaidByAmount;
    const payosLookupResponse = JSON.parse(
      JSON.stringify(paymentInfo.data),
    ) as Prisma.InputJsonValue;

    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        metadata: {
          ...metadata,
          payosLastLookup: {
            receivedAt: new Date().toISOString(),
            source: 'payos_lookup',
            response: payosLookupResponse,
          },
          integrationStatus: isPaid
            ? 'payos_lookup_paid_detected'
            : 'payos_lookup_pending',
        },
      },
    });

    if (!isPaid) {
      return {
        orderId: order.id,
        statusChanged: false,
        status: order.status,
        message: `payOS status is ${lookupData.status}`,
      };
    }

    await this.markOrderPaid(order.id, {
      providerOrderId: order.providerOrderId ?? String(lookupData.orderCode),
    });

    return {
      orderId: order.id,
      statusChanged: true,
      status: PaymentOrderStatus.PAID,
      message: 'Order was marked as paid via payOS lookup',
    };
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

  private async createPayosPayment(
    order: {
      id: string;
      userId: string;
      type: PaymentOrderType;
      packageCode: string;
    },
    amountVnd: number,
  ): Promise<PayosApiResponse<PayosPaymentData>> {
    const config = this.getPayosConfig();
    const orderCode = await this.generatePayosOrderCode();
    const description = `NEURA${orderCode}`.slice(0, 25);
    const rawSignature = this.buildPayosCreateRawSignature({
      amount: amountVnd,
      cancelUrl: config.cancelUrl,
      description,
      orderCode,
      returnUrl: config.returnUrl,
    });
    const signature = this.sign(rawSignature, config.checksumKey);

    const payload = {
      orderCode,
      amount: amountVnd,
      description,
      returnUrl: config.returnUrl,
      cancelUrl: config.cancelUrl,
      signature,
      buyerName: null,
      buyerEmail: null,
      buyerPhone: null,
      buyerAddress: null,
      items: [
        {
          name:
            order.type === PaymentOrderType.PRO_SUBSCRIPTION
              ? 'Neura Gen PRO Monthly'
              : `Neura Gen ${order.packageCode}`,
          quantity: 1,
          price: amountVnd,
        },
      ],
      expiredAt: Math.floor(Date.now() / 1000) + 30 * 60,
    };

    try {
      const response = await axios.post<PayosApiResponse<PayosPaymentData>>(
        `${config.endpoint}/v2/payment-requests`,
        payload,
        {
          headers: this.buildPayosHeaders(config),
          timeout: 30000,
        },
      );

      const data = response.data;
      if (data.code !== '00') {
        throw new BadRequestException(
          `payOS create payment failed: ${data.desc} (code ${data.code})`,
        );
      }

      if (!data.data.checkoutUrl) {
        throw new BadRequestException('payOS did not return checkoutUrl');
      }

      if (data.signature) {
        const isValid = this.verifyPayosDataSignature(
          data.data,
          data.signature,
          config.checksumKey,
        );
        if (!isValid) {
          throw new BadRequestException('payOS response signature is invalid');
        }
      }

      return data;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const message =
        axios.isAxiosError(error) && error.response?.data
          ? JSON.stringify(error.response.data)
          : error instanceof Error
            ? error.message
            : 'Unknown payOS error';

      throw new BadRequestException(`Failed to create payOS payment: ${message}`);
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

  private getPayosConfig(): PayosConfig {
    const endpoint = this.configService.get<string>('PAYOS_ENDPOINT') ?? 'https://api-merchant.payos.vn';
    const clientId = this.configService.get<string>('PAYOS_CLIENT_ID');
    const apiKey = this.configService.get<string>('PAYOS_API_KEY');
    const checksumKey = this.configService.get<string>('PAYOS_CHECKSUM_KEY');
    const returnUrl =
      this.configService.get<string>('PAYOS_RETURN_URL') ??
      'http://localhost:5173/billing/payos-return';
    const cancelUrl =
      this.configService.get<string>('PAYOS_CANCEL_URL') ?? returnUrl;
    const webhookUrl = this.configService.get<string>('PAYOS_WEBHOOK_URL') ?? undefined;
    const partnerCode = this.configService.get<string>('PAYOS_PARTNER_CODE') ?? undefined;

    if (!clientId || !apiKey || !checksumKey) {
      throw new BadRequestException(
        'Missing payOS configuration. Required: PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY',
      );
    }

    return {
      endpoint,
      clientId,
      apiKey,
      checksumKey,
      returnUrl,
      cancelUrl,
      webhookUrl,
      partnerCode,
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

  private parsePayosWebhookEnvelope(payload: Record<string, unknown>): PayosWebhookEnvelope | null {
    const code = this.asString(payload.code);
    const desc = this.asString(payload.desc);
    const signature = this.asString(payload.signature);
    const dataRaw = payload.data;

    if (!code || !desc || !signature || !dataRaw || typeof dataRaw !== 'object') {
      return null;
    }

    const data = dataRaw as Record<string, unknown>;
    const orderCode = Number(data.orderCode);
    const amount = Number(data.amount);

    if (!Number.isFinite(orderCode) || !Number.isFinite(amount)) {
      return null;
    }

    return {
      code,
      desc,
      success: typeof payload.success === 'boolean' ? payload.success : undefined,
      signature,
      data: {
        orderCode,
        amount,
        description: this.asString(data.description) ?? '',
        accountNumber: this.asString(data.accountNumber) ?? '',
        reference: this.asString(data.reference) ?? undefined,
        transactionDateTime: this.asString(data.transactionDateTime) ?? undefined,
        currency: this.asString(data.currency) ?? undefined,
        paymentLinkId: this.asString(data.paymentLinkId) ?? undefined,
        code: this.asString(data.code) ?? undefined,
        desc: this.asString(data.desc) ?? undefined,
        counterAccountBankId: this.asString(data.counterAccountBankId) ?? undefined,
        counterAccountBankName:
          this.asString(data.counterAccountBankName) ?? undefined,
        counterAccountName: this.asString(data.counterAccountName) ?? undefined,
        counterAccountNumber:
          this.asString(data.counterAccountNumber) ?? undefined,
        virtualAccountName: this.asString(data.virtualAccountName) ?? undefined,
        virtualAccountNumber:
          this.asString(data.virtualAccountNumber) ?? undefined,
      },
    };
  }

  private verifyPayosDataSignature(
    data: Record<string, unknown>,
    providedSignature: string,
    checksumKey: string,
  ): boolean {
    const rawData = this.flattenPayosData(data);
    const expected = this.sign(rawData, checksumKey);
    return this.safeCompare(expected, providedSignature);
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

  private buildPayosCreateRawSignature(input: {
    amount: number;
    cancelUrl: string;
    description: string;
    orderCode: number;
    returnUrl: string;
  }) {
    return (
      `amount=${input.amount}` +
      `&cancelUrl=${input.cancelUrl}` +
      `&description=${input.description}` +
      `&orderCode=${input.orderCode}` +
      `&returnUrl=${input.returnUrl}`
    );
  }

  private buildPayosHeaders(config: PayosConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'x-client-id': config.clientId,
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json',
    };

    if (config.partnerCode) {
      headers['x-partner-code'] = config.partnerCode;
    }

    return headers;
  }

  private flattenPayosData(input: Record<string, unknown>): string {
    return Object.keys(input)
      .sort()
      .map((key) => `${key}=${this.stringifyPayosValue(input[key])}`)
      .join('&');
  }

  private stringifyPayosValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  private extractPayosPaymentRequestId(
    metadata: Prisma.JsonValue | null,
  ): string | number | null {
    const source = this.asObject(metadata);
    const payosOrderCode = source.payosOrderCode;
    if (typeof payosOrderCode === 'number' && Number.isFinite(payosOrderCode)) {
      return payosOrderCode;
    }

    const payosMeta = this.asObject(source.payos as Prisma.JsonValue);
    const payosData = this.asObject(payosMeta.data as Prisma.JsonValue);
    const paymentLinkId = payosData.paymentLinkId;
    if (typeof paymentLinkId === 'string' && paymentLinkId.length > 0) {
      return paymentLinkId;
    }

    return null;
  }

  private async generatePayosOrderCode(): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = Number(`${Date.now()}${randomInt(10, 99)}`);
      const existingOrder = await this.prisma.paymentOrder.findFirst({
        where: {
          provider: PaymentProvider.PAYOS,
          metadata: {
            path: ['payosOrderCode'],
            equals: candidate,
          },
        },
        select: { id: true },
      });

      if (!existingOrder) {
        return candidate;
      }
    }

    throw new BadRequestException(
      'Failed to generate unique payOS orderCode. Please retry.',
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
