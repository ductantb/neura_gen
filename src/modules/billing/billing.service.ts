import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditReason,
  PaymentOrderStatus,
  PaymentOrderType,
  UserRole,
} from '@prisma/client';
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

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

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
          integrationStatus: 'pending_gateway_integration',
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
      ...order,
      note:
        'Order created. Gateway webhook chưa tích hợp, hãy dùng endpoint mark-paid để test nội bộ trước.',
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

      const paidOrder = await tx.paymentOrder.update({
        where: { id: order.id },
        data: {
          status: PaymentOrderStatus.PAID,
          paidAt: new Date(),
          providerOrderId: dto.providerOrderId ?? order.providerOrderId,
        },
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

      return {
        ...paidOrder,
        nextProExpiresAt,
      };
    });
  }
}
