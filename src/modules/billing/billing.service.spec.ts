import {
  PaymentOrderStatus,
  PaymentOrderType,
  PaymentProvider,
  UserRole,
  CreditReason,
} from '@prisma/client';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  let service: BillingService;

  const prisma = {
    paymentOrder: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
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
    service = new BillingService(prisma as any);
  });

  it('creates a pending top-up order with default package', async () => {
    prisma.paymentOrder.create.mockResolvedValue({
      id: 'order-1',
      provider: PaymentProvider.MOMO,
      type: PaymentOrderType.CREDIT_TOPUP,
      status: PaymentOrderStatus.PENDING,
      packageCode: 'TOPUP_POPULAR_9_99',
      amountUsd: '9.99',
      creditAmount: 700,
      proDurationDays: 0,
      createdAt: new Date('2026-04-10T10:00:00.000Z'),
      expiresAt: new Date('2026-04-10T10:30:00.000Z'),
    });

    const result = await service.createOrder('user-1', {
      provider: PaymentProvider.MOMO,
      type: PaymentOrderType.CREDIT_TOPUP,
    });

    expect(prisma.paymentOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          packageCode: 'TOPUP_POPULAR_9_99',
          amountUsd: '9.99',
          creditAmount: 700,
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

    prisma.paymentOrder.findUnique.mockResolvedValue({
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
    prisma.paymentOrder.findFirst.mockResolvedValue(null);
    prisma.paymentOrder.update.mockResolvedValue({
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
});
