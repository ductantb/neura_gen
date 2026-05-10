import { PaymentOrderType } from '@prisma/client';

export type CreditTopupPackage = {
  code: string;
  label: string;
  amountUsd: string;
  amountVnd: number;
  credits: number;
};

export type ProPlanPackage = {
  code: string;
  label: string;
  amountUsd: string;
  amountVnd: number;
  credits: number;
  durationDays: number;
};

export const CREDIT_TOPUP_PACKAGES: ReadonlyArray<CreditTopupPackage> = [
  {
    code: 'TOPUP_STARTER_0_99',
    label: 'Starter',
    amountUsd: '0.99',
    amountVnd: 24750,
    credits: 50,
  },
  {
    code: 'TOPUP_POPULAR_4_99',
    label: 'Popular',
    amountUsd: '4.99',
    amountVnd: 124750,
    credits: 250,
  },
  {
    code: 'TOPUP_PRO_9_99',
    label: 'Pro',
    amountUsd: '9.99',
    amountVnd: 249750,
    credits: 500,
  },
  {
    code: 'TOPUP_MAX_19_99',
    label: 'Max',
    amountUsd: '19.99',
    amountVnd: 499750,
    credits: 1000,
  },
];

export const PRO_PLAN_PACKAGE: ProPlanPackage = {
  code: 'PRO_MONTHLY_14_99',
  label: 'Pro Monthly',
  amountUsd: '14.99',
  amountVnd: 375000,
  credits: 1000,
  durationDays: 30,
};

export function resolvePackage(
  type: PaymentOrderType,
  packageCode?: string,
):
  | {
      packageCode: string;
      amountUsd: string;
      amountVnd: number;
      creditAmount: number;
      proDurationDays: number;
    }
  | null {
  if (type === PaymentOrderType.CREDIT_TOPUP) {
    const selected = packageCode
      ? CREDIT_TOPUP_PACKAGES.find((item) => item.code === packageCode)
      : CREDIT_TOPUP_PACKAGES[1];

    if (!selected) {
      return null;
    }

    return {
      packageCode: selected.code,
      amountUsd: selected.amountUsd,
      amountVnd: selected.amountVnd,
      creditAmount: selected.credits,
      proDurationDays: 0,
    };
  }

  if (type === PaymentOrderType.PRO_SUBSCRIPTION) {
    if (packageCode && packageCode !== PRO_PLAN_PACKAGE.code) {
      return null;
    }

    return {
      packageCode: PRO_PLAN_PACKAGE.code,
      amountUsd: PRO_PLAN_PACKAGE.amountUsd,
      amountVnd: PRO_PLAN_PACKAGE.amountVnd,
      creditAmount: PRO_PLAN_PACKAGE.credits,
      proDurationDays: PRO_PLAN_PACKAGE.durationDays,
    };
  }

  return null;
}
