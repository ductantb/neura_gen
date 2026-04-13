import { PaymentOrderType } from '@prisma/client';

export type CreditTopupPackage = {
  code: string;
  label: string;
  amountUsd: string;
  credits: number;
};

export type ProPlanPackage = {
  code: string;
  label: string;
  amountUsd: string;
  credits: number;
  durationDays: number;
};

export const CREDIT_TOPUP_PACKAGES: ReadonlyArray<CreditTopupPackage> = [
  {
    code: 'TOPUP_STARTER_4_99',
    label: 'Starter',
    amountUsd: '4.99',
    credits: 300,
  },
  {
    code: 'TOPUP_POPULAR_9_99',
    label: 'Popular',
    amountUsd: '9.99',
    credits: 700,
  },
  {
    code: 'TOPUP_PRO_14_99',
    label: 'Pro',
    amountUsd: '14.99',
    credits: 1000,
  },
  {
    code: 'TOPUP_MAX_19_99',
    label: 'Max',
    amountUsd: '19.99',
    credits: 1500,
  },
  {
    code: 'TOPUP_STUDIO_49_99',
    label: 'Studio',
    amountUsd: '49.99',
    credits: 4200,
  },
];

export const PRO_PLAN_PACKAGE: ProPlanPackage = {
  code: 'PRO_MONTHLY_14_99',
  label: 'Pro Monthly',
  amountUsd: '14.99',
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
      creditAmount: PRO_PLAN_PACKAGE.credits,
      proDurationDays: PRO_PLAN_PACKAGE.durationDays,
    };
  }

  return null;
}
