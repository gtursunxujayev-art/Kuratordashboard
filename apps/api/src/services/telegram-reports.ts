import crypto from 'crypto';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';

const TASHKENT_OFFSET_MINUTES = 5 * 60;
const DEFAULT_TIMEZONE = 'Asia/Tashkent';
const LINK_TOKEN_TTL_MINUTES = 30;

export type ReportPeriodKind = 'daily' | 'weekly' | 'monthly';

type PeriodRange = {
  kind: ReportPeriodKind;
  from: Date;
  to: Date;
  fromLabel: string;
  toLabel: string;
};

type KuratorSummaryRow = {
  name: string;
  studentCount: number;
  completedTasks: number;
  pendingTasks: number;
  missedStudents: number;
  performancePercent: number;
};

type CourseMatrixSection = {
  courseName: string;
  practiceNames: string[];
  rows: Array<{
    studentName: string;
    customerNumber: string;
    practicePoints: number[];
    totalPoints: number;
  }>;
};

type TenantReport = {
  tenantId: string;
  tenantName: string;
  period: PeriodRange;
  generatedAt: Date;
  kurators: KuratorSummaryRow[];
  courseSections: CourseMatrixSection[];
};

function normalizeAscii(input: string): string {
  return input
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function toTashkentDate(date: Date): Date {
  return new Date(date.getTime() + TASHKENT_OFFSET_MINUTES * 60_000);
}

function fromTashkentDate(date: Date): Date {
  return new Date(date.getTime() - TASHKENT_OFFSET_MINUTES * 60_000);
}

function startOfTashkentDay(date: Date): Date {
  const local = toTashkentDate(date);
  const startLocal = new Date(local.getFullYear(), local.getMonth(), local.getDate());
  return fromTashkentDate(startLocal);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toYmd(date: Date): string {
  const local = toTashkentDate(date);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computePreviousPeriod(kind: ReportPeriodKind, now: Date): PeriodRange {
  const todayStart = startOfTashkentDay(now);
  if (kind === 'daily') {
    const from = addDays(todayStart, -1);
    const to = todayStart;
    return { kind, from, to, fromLabel: toYmd(from), toLabel: toYmd(addDays(to, -1)) };
  }

  const localToday = toTashkentDate(todayStart);
  const weekday = localToday.getDay(); // 0 Sun .. 6 Sat
  const diffToMonday = (weekday + 6) % 7;
  const thisWeekStartLocal = new Date(localToday.getFullYear(), localToday.getMonth(), localToday.getDate() - diffToMonday);
  const thisWeekStart = fromTashkentDate(thisWeekStartLocal);

  if (kind === 'weekly') {
    const from = addDays(thisWeekStart, -7);
    const to = thisWeekStart;
    return { kind, from, to, fromLabel: toYmd(from), toLabel: toYmd(addDays(to, -1)) };
  }

  const thisMonthStartLocal = new Date(localToday.getFullYear(), localToday.getMonth(), 1);
  const thisMonthStart = fromTashkentDate(thisMonthStartLocal);
  const prevMonthStartLocal = new Date(localToday.getFullYear(), localToday.getMonth() - 1, 1);
  const prevMonthStart = fromTashkentDate(prevMonthStartLocal);
  return {
    kind,
    from: prevMonthStart,
    to: thisMonthStart,
    fromLabel: toYmd(prevMonthStart),
    toLabel: toYmd(addDays(thisMonthStart, -1)),
  };
}

function buildSimplePdf(lines: string[]): Buffer {
  const pageWidth = 595;
  const pageHeight = 842;
  const startX = 40;
  const startY = 800;
  const lineHeight = 14;
  const maxLinesPerPage = 52;

  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }
  if (pages.length === 0) {
    pages.push(['No data']);
  }

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  const contentObjectNumbers: number[] = [];

  // 1 catalog, 2 pages root
  let nextObjectNumber = 3;
  for (let i = 0; i < pages.length; i += 1) {
    pageObjectNumbers.push(nextObjectNumber);
    contentObjectNumbers.push(nextObjectNumber + 1);
    nextObjectNumber += 2;
  }
  const fontObjectNumber = nextObjectNumber;

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] >>`;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const pageObjectNumber = pageObjectNumbers[pageIndex];
    const contentObjectNumber = contentObjectNumbers[pageIndex];
    const contentLines = pages[pageIndex]
      .map((line) => `(${normalizeAscii(line)}) Tj`)
      .join(` T*${'\n'}`);
    const content = `BT\n/F1 10 Tf\n${startX} ${startY} Td\n${contentLines}\nET`;
    objects[contentObjectNumber] = `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`;
    objects[pageObjectNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
  }

  objects[fontObjectNumber] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [0];
  for (let i = 1; i <= fontObjectNumber; i += 1) {
    offsets[i] = Buffer.byteLength(chunks.join(''), 'utf8');
    chunks.push(`${i} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'utf8');
  chunks.push(`xref\n0 ${fontObjectNumber + 1}\n`);
  chunks.push(`0000000000 65535 f \n`);
  for (let i = 1; i <= fontObjectNumber; i += 1) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(
    `trailer\n<< /Size ${fontObjectNumber + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return Buffer.from(chunks.join(''), 'utf8');
}

function ensureTelegramConfigured(): { token: string; webhookSecret: string; botUsername: string | null } {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TELEGRAM_BOT_TOKEN sozlanmagan' });
  }
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TELEGRAM_WEBHOOK_SECRET sozlanmagan' });
  }
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || null;
  return { token, webhookSecret, botUsername };
}

async function telegramApiCall<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const { token } = ensureTelegramConfigured();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await response.json()) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.description || `Telegram API error (${response.status})`);
  }
  return json.result as T;
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  await telegramApiCall('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

async function sendTelegramDocument(chatId: string, filename: string, pdfBuffer: Buffer, caption: string): Promise<void> {
  const { token } = ensureTelegramConfigured();
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('document', new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }), filename);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  const json = (await response.json()) as { ok?: boolean; description?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.description || `Telegram sendDocument error (${response.status})`);
  }
}

async function buildKuratorSummary(tenantId: string, period: PeriodRange): Promise<KuratorSummaryRow[]> {
  const [kurators, assignments, completedGroups, pendingGroups, missedRows] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId, roles: { has: 'Kurator' }, isActive: true },
      select: { id: true, name: true, username: true },
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
    }),
    prisma.kuratorAssignment.findMany({
      where: { tenantId, isActive: true },
      select: { kuratorUserId: true, customerId: true },
    }),
    prisma.kuratorTask.groupBy({
      by: ['kuratorUserId'],
      where: {
        tenantId,
        completedAt: { gte: period.from, lt: period.to },
      },
      _count: { id: true },
    }),
    prisma.kuratorTask.groupBy({
      by: ['kuratorUserId'],
      where: {
        tenantId,
        completedAt: null,
        createdAt: { gte: period.from, lt: period.to },
      },
      _count: { id: true },
    }),
    prisma.classAttendance.findMany({
      where: {
        tenantId,
        attended: false,
        lessonDate: { gte: period.from, lt: period.to },
      },
      select: { customerId: true },
      distinct: ['customerId'],
    }),
  ]);

  const customerToKurators = new Map<string, Set<string>>();
  const studentsByKurator = new Map<string, Set<string>>();
  for (const row of assignments) {
    const kuratorSet = customerToKurators.get(row.customerId) ?? new Set<string>();
    kuratorSet.add(row.kuratorUserId);
    customerToKurators.set(row.customerId, kuratorSet);

    const studentSet = studentsByKurator.get(row.kuratorUserId) ?? new Set<string>();
    studentSet.add(row.customerId);
    studentsByKurator.set(row.kuratorUserId, studentSet);
  }

  const missedByKurator = new Map<string, number>();
  for (const row of missedRows) {
    const kuratorSet = customerToKurators.get(row.customerId) ?? new Set<string>();
    for (const kuratorId of kuratorSet) {
      missedByKurator.set(kuratorId, (missedByKurator.get(kuratorId) ?? 0) + 1);
    }
  }

  const completedByKurator = new Map(completedGroups.map((row) => [row.kuratorUserId, row._count.id]));
  const pendingByKurator = new Map(pendingGroups.map((row) => [row.kuratorUserId, row._count.id]));

  return kurators.map((kurator) => {
    const completed = completedByKurator.get(kurator.id) ?? 0;
    const pending = pendingByKurator.get(kurator.id) ?? 0;
    const total = completed + pending;
    return {
      name: kurator.name ?? kurator.username ?? 'Kurator',
      studentCount: studentsByKurator.get(kurator.id)?.size ?? 0,
      completedTasks: completed,
      pendingTasks: pending,
      missedStudents: missedByKurator.get(kurator.id) ?? 0,
      performancePercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  });
}

async function buildCourseSections(tenantId: string, period: PeriodRange): Promise<CourseMatrixSection[]> {
  const courses = await prisma.course.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const sections: CourseMatrixSection[] = [];
  for (const course of courses) {
    const [practices, enrollments] = await Promise.all([
      prisma.exerciseDefinition.findMany({
        where: { tenantId, courseId: course.id, isActive: true },
        select: { id: true, name: true, type: true },
        orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
      }),
      prisma.income.findMany({
        where: {
          tenantId,
          courseId: course.id,
          type: 'new_sale',
          lifecycleStatus: 'active',
        },
        select: { customerId: true },
        distinct: ['customerId'],
      }),
    ]);

    const studentIds = enrollments.map((row) => row.customerId);
    if (studentIds.length === 0) continue;

    const students = await prisma.customer.findMany({
      where: { tenantId, id: { in: studentIds } },
      select: { id: true, name: true, customerNumber: true },
      orderBy: { name: 'asc' },
    });

    const practiceIds = practices.map((row) => row.id);
    const logs =
      practiceIds.length > 0
        ? await prisma.studentExerciseLog.findMany({
            where: {
              tenantId,
              customerId: { in: studentIds },
              exerciseDefinitionId: { in: practiceIds },
              completedAt: { gte: period.from, lt: period.to },
            },
            select: {
              customerId: true,
              exerciseDefinitionId: true,
              points: true,
            },
          })
        : [];

    const pointsByCell = new Map<string, number>();
    for (const log of logs) {
      const key = `${log.customerId}:${log.exerciseDefinitionId}`;
      const current = pointsByCell.get(key) ?? 0;
      pointsByCell.set(key, current + Number(log.points ?? 0));
    }

    const rows = students.map((student) => {
      let totalPoints = 0;
      const practicePoints = practices.map((practice) => {
        const points = pointsByCell.get(`${student.id}:${practice.id}`) ?? 0;
        if (practice.type !== 'extra') {
          totalPoints += points;
        }
        return points;
      });
      return {
        studentName: student.name,
        customerNumber: student.customerNumber,
        practicePoints,
        totalPoints,
      };
    });

    sections.push({
      courseName: course.name,
      practiceNames: practices.map((row) => row.name),
      rows,
    });
  }

  return sections;
}

function buildReportLines(report: TenantReport): string[] {
  const lines: string[] = [];
  lines.push('Kuratordashboard Telegram Report');
  lines.push(`Tenant: ${report.tenantName}`);
  lines.push(`Period: ${report.period.kind} (${report.period.fromLabel} .. ${report.period.toLabel})`);
  lines.push(`Generated: ${report.generatedAt.toISOString()}`);
  lines.push('');
  lines.push('Kuratorlar summary:');
  lines.push('Name | Students | Done | Pending | Missed | Perf%');
  if (report.kurators.length === 0) {
    lines.push('No kurators');
  } else {
    for (const row of report.kurators) {
      lines.push(
        `${row.name} | ${row.studentCount} | ${row.completedTasks} | ${row.pendingTasks} | ${row.missedStudents} | ${row.performancePercent}`,
      );
    }
  }

  lines.push('');
  lines.push('Hisobot jadvali (active courses):');
  if (report.courseSections.length === 0) {
    lines.push('No active course sections');
    return lines;
  }

  for (const section of report.courseSections) {
    lines.push('');
    lines.push(`Course: ${section.courseName}`);
    if (section.practiceNames.length === 0) {
      lines.push('No active practices');
      continue;
    }
    lines.push(`Practices: ${section.practiceNames.join(' | ')}`);
    for (const row of section.rows) {
      const pointCells = row.practicePoints.map((value) => (value === 0 ? '-' : String(value))).join(' | ');
      lines.push(`${row.studentName} (${row.customerNumber}) => ${pointCells} || total=${row.totalPoints}`);
    }
  }
  return lines;
}

async function buildTenantReport(tenantId: string, period: PeriodRange): Promise<TenantReport> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const [kurators, courseSections] = await Promise.all([
    buildKuratorSummary(tenant.id, period),
    buildCourseSections(tenant.id, period),
  ]);

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    period,
    generatedAt: new Date(),
    kurators,
    courseSections,
  };
}

async function sendTenantReportToAdmins(tenantId: string, period: PeriodRange): Promise<{
  recipients: number;
  sent: number;
  failed: number;
}> {
  const admins = await prisma.user.findMany({
    where: {
      tenantId,
      isActive: true,
      roles: { has: 'Admin' },
      telegramId: { not: null },
    },
    select: { id: true, telegramId: true, name: true, username: true },
  });

  if (admins.length === 0) {
    return { recipients: 0, sent: 0, failed: 0 };
  }

  const report = await buildTenantReport(tenantId, period);
  const lines = buildReportLines(report);
  const pdf = buildSimplePdf(lines);
  const caption = `Hisobot: ${period.kind} (${period.fromLabel} .. ${period.toLabel})`;
  const filename = `hisobot-${period.kind}-${period.fromLabel}-${period.toLabel}.pdf`;

  let sent = 0;
  let failed = 0;
  for (const admin of admins) {
    const recipient = admin.telegramId ?? '';
    try {
      await sendTelegramDocument(recipient, filename, pdf, caption);
      sent += 1;
      await prisma.reportDeliveryLog.create({
        data: {
          tenantId,
          periodKind: period.kind,
          dateFrom: period.from,
          dateTo: period.to,
          recipient,
          status: 'sent',
        },
      });
    } catch (error) {
      failed += 1;
      await prisma.reportDeliveryLog.create({
        data: {
          tenantId,
          periodKind: period.kind,
          dateFrom: period.from,
          dateTo: period.to,
          recipient,
          status: 'failed',
          error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        },
      });
    }
  }

  return { recipients: admins.length, sent, failed };
}

export function validateCronSecret(provided: string | null | undefined): boolean {
  const expected = process.env.REPORT_CRON_SECRET?.trim();
  if (!expected) return false;
  return provided === expected;
}

export async function runTelegramScheduledReports(kind: ReportPeriodKind, now = new Date()): Promise<{
  period: PeriodRange;
  tenants: number;
  recipients: number;
  sent: number;
  failed: number;
}> {
  ensureTelegramConfigured();
  const period = computePreviousPeriod(kind, now);
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  let recipients = 0;
  let sent = 0;
  let failed = 0;

  for (const tenant of tenants) {
    const result = await sendTenantReportToAdmins(tenant.id, period);
    recipients += result.recipients;
    sent += result.sent;
    failed += result.failed;
  }

  return { period, tenants: tenants.length, recipients, sent, failed };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createTelegramLinkToken(tenantId: string, userId: string): Promise<{
  token: string;
  deepLink: string | null;
  expiresAt: Date;
}> {
  ensureTelegramConfigured();

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId,
      isActive: true,
      roles: { has: 'Admin' },
    },
    select: { id: true },
  });
  if (!user) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Faqat faol admin Telegram bog'lay oladi" });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MINUTES * 60_000);

  await prisma.telegramLinkToken.create({
    data: {
      tenantId,
      userId,
      tokenHash,
      expiresAt,
    },
  });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || null;
  return {
    token,
    deepLink: botUsername ? `https://t.me/${botUsername}?start=${token}` : null,
    expiresAt,
  };
}

export async function handleTelegramWebhook(update: any): Promise<{ handled: boolean; message?: string }> {
  ensureTelegramConfigured();
  const messageText = String(update?.message?.text ?? '').trim();
  const chatIdRaw = update?.message?.chat?.id;
  if (!messageText || !chatIdRaw) {
    return { handled: false, message: 'No message payload' };
  }

  if (!messageText.toLowerCase().startsWith('/start')) {
    await sendTelegramMessage(String(chatIdRaw), "Bot ishlayapti. Admin paneldan berilgan /start tokenni yuboring.");
    return { handled: true, message: 'Non-start message acknowledged' };
  }

  const parts = messageText.split(/\s+/);
  const startToken = parts[1];
  if (!startToken) {
    await sendTelegramMessage(String(chatIdRaw), 'Token topilmadi. Admin paneldan yangi ulash tokenini oling.');
    return { handled: true, message: 'Missing token' };
  }

  const tokenHash = hashToken(startToken);
  const link = await prisma.telegramLinkToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      usedAt: true,
      expiresAt: true,
    },
  });
  if (!link || link.usedAt || link.expiresAt.getTime() < Date.now()) {
    await sendTelegramMessage(String(chatIdRaw), 'Token yaroqsiz yoki muddati tugagan. Yangi token oling.');
    return { handled: true, message: 'Invalid token' };
  }

  const user = await prisma.user.findFirst({
    where: {
      id: link.userId,
      tenantId: link.tenantId,
      isActive: true,
      roles: { has: 'Admin' },
    },
    select: { id: true, name: true, username: true },
  });
  if (!user) {
    await sendTelegramMessage(String(chatIdRaw), "Bu token uchun admin foydalanuvchi topilmadi.");
    return { handled: true, message: 'Admin not found' };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { telegramId: String(chatIdRaw) },
    }),
    prisma.telegramLinkToken.update({
      where: { id: link.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await sendTelegramMessage(
    String(chatIdRaw),
    `Ulanish muvaffaqiyatli. ${user.name ?? user.username ?? 'Admin'} uchun hisobotlar shu chatga yuboriladi.`,
  );
  return { handled: true, message: 'Linked' };
}

export async function getTelegramReportStatus(tenantId: string): Promise<{
  configured: boolean;
  timezone: string;
  botUsername: string | null;
  admins: Array<{ id: string; name: string; username: string | null; hasTelegram: boolean; telegramIdMasked: string | null }>;
}> {
  const botConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
  const admins = await prisma.user.findMany({
    where: {
      tenantId,
      isActive: true,
      roles: { has: 'Admin' },
    },
    select: { id: true, name: true, username: true, telegramId: true },
    orderBy: [{ name: 'asc' }, { username: 'asc' }],
  });

  return {
    configured: botConfigured,
    timezone: process.env.REPORT_TIMEZONE || DEFAULT_TIMEZONE,
    botUsername: process.env.TELEGRAM_BOT_USERNAME?.trim() || null,
    admins: admins.map((admin) => ({
      id: admin.id,
      name: admin.name ?? admin.username ?? 'Admin',
      username: admin.username ?? null,
      hasTelegram: Boolean(admin.telegramId),
      telegramIdMasked: admin.telegramId ? `***${admin.telegramId.slice(-4)}` : null,
    })),
  };
}

export async function sendTelegramTestReport(tenantId: string, userId: string): Promise<{ sent: boolean; recipient: string }> {
  ensureTelegramConfigured();
  const admin = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId,
      isActive: true,
      roles: { has: 'Admin' },
    },
    select: { telegramId: true },
  });
  if (!admin?.telegramId) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "Admin uchun telegram bog'lanmagan" });
  }

  const period = computePreviousPeriod('daily', new Date());
  const report = await buildTenantReport(tenantId, period);
  const pdf = buildSimplePdf(buildReportLines(report));
  await sendTelegramDocument(
    admin.telegramId,
    `hisobot-test-${period.fromLabel}.pdf`,
    pdf,
    `Test hisobot (${period.fromLabel} .. ${period.toLabel})`,
  );
  return { sent: true, recipient: admin.telegramId };
}

export function getTelegramWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}
