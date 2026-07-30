import { prisma } from '@kuratordashboard/db';

type TelegramDispatch = {
  attempted: boolean;
  delivered: boolean;
  sentCount: number;
  failedCount: number;
  reason?: 'dashboarduz_not_configured' | 'send_failed';
  errors?: string[];
};

function getGroupIds(): string[] {
  const values = [
    process.env.DASHBOARDUZ_PAYMENT_GROUP_ID,
    process.env.DASHBOARDUZ_PAYMENT_GROUP_IDS,
    process.env.OFLINE_GROUP_ID,
    process.env.OFFLINE_GROUP_ID,
    process.env.OFLINE_GROUP_IDS,
    process.env.OFFLINE_GROUP_IDS,
  ];
  return Array.from(new Set(
    values.flatMap((value) => String(value || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean)),
  ));
}

function getDashboarduzTelegramEndpoint(): string | null {
  const explicitEndpoint = process.env.DASHBOARDUZ_TELEGRAM_ENDPOINT?.trim();
  if (explicitEndpoint) return explicitEndpoint;

  const apiUrl = process.env.DASHBOARDUZ_API_URL?.trim().replace(/\/+$/, '');
  return apiUrl ? `${apiUrl}/debug/telegram` : null;
}

async function sendReceiptViaDashboarduz(params: {
  tenantId: string;
  text: string;
}): Promise<TelegramDispatch> {
  const endpoint = getDashboarduzTelegramEndpoint();
  const secret = (
    process.env.DASHBOARDUZ_TELEGRAM_SECRET
    || process.env.DASHBOARDUZ_TELEGRAM_DEBUG_KEY
  )?.trim();
  const configuredGroups = getGroupIds();
  if (!endpoint || !secret || !configuredGroups.length) {
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'dashboarduz_not_configured',
      errors: [
        'Dashboarduz URL, Telegram secret yoki intensiv to‘lov guruhi sozlanmagan',
      ],
    };
  }

  const errors: string[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const groupId of configuredGroups) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-debug-key': secret,
        },
        body: JSON.stringify({
          tenantId: params.tenantId,
          text: params.text,
          group_id: groupId,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json() as {
        ok?: boolean;
        deliveredCount?: number;
        failedCount?: number;
        error?: string;
        results?: Array<{ groupId?: string; ok?: boolean; error?: string }>;
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.error || `Dashboarduz Telegram gateway ${response.status}`);
      }
      sentCount += body.deliveredCount ?? body.results?.filter((item) => item.ok).length ?? 0;
      failedCount += body.failedCount ?? body.results?.filter((item) => !item.ok).length ?? 0;
      for (const result of body.results ?? []) {
        if (!result.ok) errors.push(`${result.groupId ?? groupId ?? 'group'}: ${result.error ?? 'Yuborilmadi'}`);
      }
    } catch (error) {
      failedCount += 1;
      errors.push(`${groupId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    attempted: true,
    delivered: sentCount > 0,
    sentCount,
    failedCount,
    ...(sentCount ? {} : { reason: 'send_failed' as const }),
    ...(errors.length ? { errors: errors.slice(0, 3) } : {}),
  };
}

function toHashtag(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');
  return normalized ? `#${normalized}` : null;
}

function formatAmount(value: number): string {
  return `${new Intl.NumberFormat('uz-UZ').format(value)} so'm`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

function readSubTariffId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).saleSubTariffId;
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

export async function sendIntensivePaymentReceipt(params: {
  tenantId: string;
  saleId: string;
  repaymentId: string;
}): Promise<TelegramDispatch> {
  const [sale, repayment] = await Promise.all([
    prisma.income.findFirst({
      where: { id: params.saleId, tenantId: params.tenantId },
      select: {
        coursePriceAmount: true,
        debtAmount: true,
        remainingDebtAmount: true,
        deadline: true,
        legacyImportMeta: true,
        customer: { select: { name: true, customerNumber: true, telegramUsername: true } },
        course: { select: { name: true } },
        tariff: { select: { name: true } },
      },
    }),
    prisma.income.findFirst({
      where: { id: params.repaymentId, tenantId: params.tenantId },
      select: { manager: { select: { name: true, username: true } } },
    }),
  ]);
  if (!sale?.customer || !repayment) {
    return { attempted: false, delivered: false, sentCount: 0, failedCount: 0, reason: 'send_failed', errors: ['To\'lov ma\'lumotlari topilmadi'] };
  }

  const subTariffId = readSubTariffId(sale.legacyImportMeta);
  const subTariff = subTariffId
    ? await prisma.subTariff.findFirst({ where: { id: subTariffId, tenantId: params.tenantId }, select: { name: true } })
    : null;
  const paymentRows = await prisma.income.findMany({
    where: { tenantId: params.tenantId, lifecycleStatus: 'active', OR: [{ id: params.saleId }, { relatedDebtIncomeId: params.saleId }] },
    select: { paymentAmount: true, entryDate: true },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });

  const customerTelegram = sale.customer.telegramUsername
    ? (sale.customer.telegramUsername.startsWith('@') ? sale.customer.telegramUsername : `@${sale.customer.telegramUsername}`)
    : '-';
  const tags = [
    toHashtag(sale.course?.name), toHashtag(sale.tariff?.name), toHashtag(subTariff?.name),
    toHashtag(repayment.manager.name || repayment.manager.username),
  ].filter(Boolean);
  const agreement = sale.coursePriceAmount ?? sale.debtAmount ?? 0;
  const payments = paymentRows.map((row, index) => `${index + 1}) ${formatAmount(row.paymentAmount)} - ${formatDate(row.entryDate)}`);
  const text = [
    ...tags, '', `1.Mijoz: ${sale.customer.name}`, `2.Tel: ${sale.customer.customerNumber}`,
    `3.Tg: ${customerTelegram}`, '', `Narxi - ${formatAmount(agreement)}`, '', "To'lov:", '',
    ...(payments.length ? payments : ['1) -']), '', `Qarz: ${formatAmount(sale.remainingDebtAmount)}`,
    `Deadline: ${sale.deadline ? formatDate(sale.deadline) : '-'}`, '', '@Moliya_b0limi', '@najotnur_oflayn',
  ].join('\n');

  return sendReceiptViaDashboarduz({ tenantId: params.tenantId, text });
}

export async function finalizeExpiredIntensiveTransitAttendance(now = new Date()): Promise<{ finalized: number }> {
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const today = new Date(`${todayKey}T00:00:00`);
  const result = await prisma.classAttendance.updateMany({
    where: {
      status: 'yolda',
      lessonDate: { lt: today },
      courseRun: { isSystemManaged: true },
    },
    data: { status: 'kelmadi', attended: false },
  });
  return { finalized: result.count };
}
