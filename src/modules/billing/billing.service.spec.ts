import {
  PaymentOrderStatus,
  PaymentOrderType,
  PaymentProvider,
  UserRole,
  CreditReason,
} from '@prisma/client';
import axios from 'axios';
import { createHmac } from 'crypto';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  let service: BillingService;
  const configService = {
    get: jest.fn(),
  };

  const prisma = {
    paymentOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    userCredit: {
      upsert: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    creditTransaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BillingService(prisma as any, configService as any);
  });

  it('creates a pending top-up order with default package', async () => {
    prisma.paymentOrder.create.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      provider: PaymentProvider.BANK_TRANSFER,
      type: PaymentOrderType.CREDIT_TOPUP,
      status: PaymentOrderStatus.PENDING,
      packageCode: 'TOPUP_POPULAR_4_99',
      amountUsd: '4.99',
      creditAmount: 250,
      proDurationDays: 0,
      createdAt: new Date('2026-04-10T10:00:00.000Z'),
      expiresAt: new Date('2026-04-10T10:30:00.000Z'),
      metadata: { amountVnd: 124750 },
    });

    const result = await service.createOrder('user-1', {
      provider: PaymentProvider.BANK_TRANSFER,
      type: PaymentOrderType.CREDIT_TOPUP,
    });

    expect(prisma.paymentOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          packageCode: 'TOPUP_POPULAR_4_99',
          amountUsd: '4.99',
          creditAmount: 250,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'order-1',
        status: PaymentOrderStatus.PENDING,
      }),
    );
  });

  it('marks a pro order as paid and upgrades role with credits', async () => {
    const now = new Date('2026-04-10T10:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        paymentOrder: {
          findUnique: prisma.paymentOrder.findUnique,
          findFirst: prisma.paymentOrder.findFirst,
          updateMany: prisma.paymentOrder.updateMany,
          update: prisma.paymentOrder.update,
        },
        userCredit: {
          upsert: prisma.userCredit.upsert,
        },
        user: {
          update: prisma.user.update,
        },
        creditTransaction: {
          create: prisma.creditTransaction.create,
        },
      }),
    );

    prisma.paymentOrder.findFirst.mockResolvedValue(null);
    prisma.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.paymentOrder.findUnique.mockResolvedValueOnce({
      id: 'order-pro',
      userId: 'user-1',
      provider: PaymentProvider.BANK_TRANSFER,
      type: PaymentOrderType.PRO_SUBSCRIPTION,
      status: PaymentOrderStatus.PENDING,
      packageCode: 'PRO_MONTHLY_14_99',
      amountUsd: '14.99',
      creditAmount: 1000,
      proDurationDays: 30,
      providerOrderId: null,
      user: {
        id: 'user-1',
        role: UserRole.FREE,
        proExpiresAt: null,
      },
    });
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-pro',
      status: PaymentOrderStatus.PAID,
      type: PaymentOrderType.PRO_SUBSCRIPTION,
      packageCode: 'PRO_MONTHLY_14_99',
      amountUsd: '14.99',
      creditAmount: 1000,
      proDurationDays: 30,
      providerOrderId: 'BANK_TXN_1',
      paidAt: now,
    });

    const result = await service.markOrderPaid('order-pro', {
      providerOrderId: 'BANK_TXN_1',
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: UserRole.PRO,
        }),
      }),
    );
    expect(prisma.creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          amount: 1000,
          reason: CreditReason.PURCHASE_PRO_SUBSCRIPTION,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'order-pro',
        status: PaymentOrderStatus.PAID,
        creditAmount: 1000,
      }),
    );

    jest.useRealTimers();
  });

  it('creates payOS payment link and returns checkoutUrl', async () => {
    const configMap: Record<string, string> = {
      PAYOS_ENDPOINT: 'https://api-merchant.payos.vn',
      PAYOS_CLIENT_ID: 'client-id',
      PAYOS_API_KEY: 'api-key',
      PAYOS_CHECKSUM_KEY: 'checksum-key',
      PAYOS_RETURN_URL: 'http://localhost:5173/billing/payos-return',
      PAYOS_CANCEL_URL: 'http://localhost:5173/billing/payos-return',
    };
    configService.get.mockImplementation((key: string) => configMap[key]);
    prisma.paymentOrder.findFirst.mockResolvedValue(null);
    prisma.paymentOrder.create.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      provider: PaymentProvider.PAYOS,
      type: PaymentOrderType.CREDIT_TOPUP,
      status: PaymentOrderStatus.PENDING,
      packageCode: 'TOPUP_POPULAR_4_99',
      amountUsd: '4.99',
      creditAmount: 250,
      proDurationDays: 0,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
      expiresAt: new Date('2026-04-18T10:30:00.000Z'),
      metadata: { amountVnd: 124750 },
    });
    prisma.paymentOrder.update.mockResolvedValue({
      id: 'order-1',
      provider: PaymentProvider.PAYOS,
      type: PaymentOrderType.CREDIT_TOPUP,
      status: PaymentOrderStatus.PENDING,
      packageCode: 'TOPUP_POPULAR_4_99',
      amountUsd: '4.99',
      creditAmount: 250,
      proDurationDays: 0,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
      expiresAt: new Date('2026-04-18T10:30:00.000Z'),
    });

    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        code: '00',
        desc: 'success',
        data: {
          bin: '970418',
          accountNumber: '123456789',
          accountName: 'NEURA GEN',
          amount: 124750,
          description: 'NEURA1234567890123',
          orderCode: 123456789012345,
          currency: 'VND',
          paymentLinkId: 'plink_1',
          status: 'PENDING',
          checkoutUrl: 'https://pay.payos.vn/web/abc',
          qrCode: '000201010212...',
        },
      },
    } as any);

    const result = await service.createOrder('user-1', {
      provider: PaymentProvider.PAYOS,
      type: PaymentOrderType.CREDIT_TOPUP,
      packageCode: 'TOPUP_POPULAR_4_99',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'order-1',
        provider: PaymentProvider.PAYOS,
        payUrl: 'https://pay.payos.vn/web/abc',
        paymentLinkId: 'plink_1',
      }),
    );
    expect(postSpy).toHaveBeenCalled();
    postSpy.mockRestore();
  });

  it('accepts valid MoMo IPN and marks order as paid', async () => {
    const configMap: Record<string, string> = {
      MOMO_ENDPOINT: 'https://test-payment.momo.vn',
      MOMO_PARTNER_CODE: 'MOMO_TEST',
      MOMO_ACCESS_KEY: 'test-access-key',
      MOMO_SECRET_KEY: 'test-secret-key',
      MOMO_REDIRECT_URL: 'https://example.com/return',
      MOMO_IPN_URL: 'https://example.com/ipn',
      MOMO_REQUEST_TYPE: 'payWithMethod',
      MOMO_LANG: 'vi',
      MOMO_AUTO_CAPTURE: 'true',
    };
    configService.get.mockImplementation((key: string) => configMap[key]);
    prisma.paymentOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      status: PaymentOrderStatus.PENDING,
      provider: PaymentProvider.MOMO,
      metadata: {
        amountVnd: 124750,
      },
    });
    prisma.paymentOrder.update.mockResolvedValue({});

    const markOrderPaidSpy = jest
      .spyOn(service, 'markOrderPaid')
      .mockResolvedValue({ status: PaymentOrderStatus.PAID } as any);

    const payload = {
      orderType: 'momo_wallet',
      amount: 124750,
      partnerCode: 'MOMO_TEST',
      orderId: 'order-1',
      extraData: '',
      transId: 1234567890,
      responseTime: 1721720663942,
      resultCode: 0,
      message: 'Successful.',
      payType: 'qr',
      requestId: 'order-1',
      orderInfo: 'Neura Gen credit topup',
    };

    const rawSignature =
      `accessKey=${configMap.MOMO_ACCESS_KEY}` +
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

    const signature = createHmac('sha256', configMap.MOMO_SECRET_KEY)
      .update(rawSignature)
      .digest('hex');

    await service.handleMomoIpn({
      ...payload,
      signature,
    });

    expect(markOrderPaidSpy).toHaveBeenCalledWith('order-1', {
      providerOrderId: '1234567890',
    });

    markOrderPaidSpy.mockRestore();
  });

  it('accepts valid payOS webhook and marks order as paid', async () => {
    const configMap: Record<string, string> = {
      PAYOS_ENDPOINT: 'https://api-merchant.payos.vn',
      PAYOS_CLIENT_ID: 'client-id',
      PAYOS_API_KEY: 'api-key',
      PAYOS_CHECKSUM_KEY: 'checksum-key',
      PAYOS_RETURN_URL: 'http://localhost:5173/billing/payos-return',
      PAYOS_CANCEL_URL: 'http://localhost:5173/billing/payos-return',
    };
    configService.get.mockImplementation((key: string) => configMap[key]);
    prisma.paymentOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      status: PaymentOrderStatus.PENDING,
      provider: PaymentProvider.PAYOS,
      metadata: {
        amountVnd: 124750,
        payosOrderCode: 123456789012345,
      },
    });
    prisma.paymentOrder.update.mockResolvedValue({});

    const markOrderPaidSpy = jest
      .spyOn(service, 'markOrderPaid')
      .mockResolvedValue({ status: PaymentOrderStatus.PAID } as any);

    const webhookData = {
      orderCode: 123456789012345,
      amount: 124750,
      description: 'NEURA1234567890123',
      accountNumber: '123456789',
      reference: 'FT123456',
      transactionDateTime: '2026-04-18 10:30:00',
      currency: 'VND',
      paymentLinkId: 'plink_1',
      code: '00',
      desc: 'success',
      counterAccountBankId: '',
      counterAccountBankName: '',
      counterAccountName: '',
      counterAccountNumber: '',
      virtualAccountName: '',
      virtualAccountNumber: '',
    };

    const webhookRaw = Object.keys(webhookData)
      .sort()
      .map((key) => `${key}=${(webhookData as any)[key]}`)
      .join('&');

    const signature = createHmac('sha256', configMap.PAYOS_CHECKSUM_KEY)
      .update(webhookRaw)
      .digest('hex');

    await service.handlePayosWebhook({
      code: '00',
      desc: 'success',
      data: webhookData,
      signature,
      success: true,
    });

    expect(markOrderPaidSpy).toHaveBeenCalledWith('order-1', {
      providerOrderId: 'FT123456',
    });

    markOrderPaidSpy.mockRestore();
  });

  it('confirms payOS webhook URL from env', async () => {
    const configMap: Record<string, string> = {
      PAYOS_ENDPOINT: 'https://api-merchant.payos.vn',
      PAYOS_CLIENT_ID: 'client-id',
      PAYOS_API_KEY: 'api-key',
      PAYOS_CHECKSUM_KEY: 'checksum-key',
      PAYOS_RETURN_URL: 'http://localhost:5173/billing/payos-return',
      PAYOS_CANCEL_URL: 'http://localhost:5173/billing/payos-return',
      PAYOS_WEBHOOK_URL: 'https://api.example.com/billing/webhooks/payos',
    };
    configService.get.mockImplementation((key: string) => configMap[key]);

    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        code: '00',
        desc: 'success',
        data: {
          webhookUrl: configMap.PAYOS_WEBHOOK_URL,
        },
      },
    } as any);

    const result = await service.confirmPayosWebhook();

    expect(postSpy).toHaveBeenCalledWith(
      'https://api-merchant.payos.vn/confirm-webhook',
      {
        webhookUrl: configMap.PAYOS_WEBHOOK_URL,
      },
      expect.anything(),
    );
    expect(result).toEqual(
      expect.objectContaining({
        webhookUrl: configMap.PAYOS_WEBHOOK_URL,
      }),
    );

    postSpy.mockRestore();
  });
});
