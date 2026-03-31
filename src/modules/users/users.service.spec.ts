import { CreditReason } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    userCredit: {
      upsert: jest.fn(),
    },
    creditTransaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma as any);
  });

  it('tops up credits for the current user and creates a transaction', async () => {
    const createdAt = new Date('2026-03-31T03:45:00.000Z');

    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        user: {
          findUnique: prisma.user.findUnique,
        },
        userCredit: {
          upsert: prisma.userCredit.upsert,
        },
        creditTransaction: {
          create: prisma.creditTransaction.create,
        },
      }),
    );

    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.userCredit.upsert.mockResolvedValue({
      userId: 'user-1',
      balance: 150,
      updatedAt: createdAt,
    });
    prisma.creditTransaction.create.mockResolvedValue({
      id: 'txn-1',
      reason: CreditReason.TEST_REWARD,
      createdAt,
    });

    const result = await service.topUpMyCredits('user-1', {
      amount: 50,
      note: 'test topup',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true },
    });
    expect(prisma.userCredit.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {
        balance: {
          increment: 50,
        },
      },
      create: {
        userId: 'user-1',
        balance: 50,
      },
    });
    expect(prisma.creditTransaction.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        amount: 50,
        reason: CreditReason.TEST_REWARD,
        metadata: {
          source: 'manual_test_topup_api',
          note: 'test topup',
        },
      },
    });
    expect(result).toEqual({
      userId: 'user-1',
      amount: 50,
      balance: 150,
      reason: CreditReason.TEST_REWARD,
      transactionId: 'txn-1',
      note: 'test topup',
      createdAt,
    });
  });

  it('throws when the current user is not found', async () => {
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        user: {
          findUnique: prisma.user.findUnique,
        },
        userCredit: {
          upsert: prisma.userCredit.upsert,
        },
        creditTransaction: {
          create: prisma.creditTransaction.create,
        },
      }),
    );

    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.topUpMyCredits('missing-user', { amount: 10 }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.userCredit.upsert).not.toHaveBeenCalled();
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
  });
});
