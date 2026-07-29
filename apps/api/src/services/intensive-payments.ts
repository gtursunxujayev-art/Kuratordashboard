import { prisma } from '@kuratordashboard/db';

type TelegramDispatch = {
  attempted: boolean;
  delivered: boolean;
  sentCount: number;
  failedCount: number;
  reason?: 'bot_token_missing' | 'groups_missing' | 'send_failed';
  errors?: string[];
};

function getGroupIds(): string[] {
  const values = [
    process.env.OFLINE_GROUP_ID,
    process.env.OFFLINE_GROUP_ID,
    process.env.OFLINE_GROUP_IDS,
    process.env.OFFLINE_GROUP_IDS,
  ];
  return Array.from(new Set(
    values.flatMap((value) => String(value || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean)),
  ));
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
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return { attempted: false, delivered: false, sentCount: 0, failedCount: 0, reason: 'bot_token_missing' };
  }
  const groupIds = getGroupIds();
  if (!groupIds.length) {
    return { attempted: false, delivered: false, sentCount: 0, failedCount: 0, reason: 'groups_missing' };
  }

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

  const errors: string[] = [];
  let sentCount = 0;
  for (const groupId of groupIds) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: groupId, text, disable_web_page_preview: true }),
      });
      const body = await response.json() as { ok?: boolean; description?: string };
      if (!response.ok || !body.ok) throw new Error(body.description || `Telegram API ${response.status}`);
      sentCount += 1;
    } catch (error) {
      errors.push(`${groupId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    attempted: true,
    delivered: sentCount > 0,
    sentCount,
    failedCount: groupIds.length - sentCount,
    ...(sentCount ? {} : { reason: 'send_failed' as const }),
    ...(errors.length ? { errors: errors.slice(0, 3) } : {}),
  };
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
