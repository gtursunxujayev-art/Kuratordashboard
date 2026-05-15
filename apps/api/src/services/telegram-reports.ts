import crypto from 'crypto';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { renderReportPdf } from './telegram-report-pdf';

const TASHKENT_OFFSET_MINUTES = 5 * 60;
const DEFAULT_TIMEZONE = 'Asia/Tashkent';
const LINK_TOKEN_TTL_MINUTES = 30;

export type ReportPeriodKind = 'daily' | 'weekly' | 'monthly';
export type TestReportPreset = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month';

export type PeriodRange = {
  kind: ReportPeriodKind;
  from: Date;
  to: Date;
  fromLabel: string;
  toLabel: string;
};

export type KuratorSummaryRow = {
  name: string;
  studentCount: number;
  completedTasks: number;
  pendingTasks: number;
  missedStudents: number;
  performancePercent: number;
};

export type KuratorSummaryByType = {
  online: KuratorSummaryRow[];
  offline: KuratorSummaryRow[];
  all: KuratorSummaryRow[];
};

export type CourseMatrixSection = {
  courseType: 'online' | 'offline';
  courseName: string;
  practiceNames: string[];
  rows: Array<{
    studentName: string;
    practicePoints: number[];
    totalPoints: number;
  }>;
};

export type TenantReport = {
  tenantId: string;
  tenantName: string;
  period: PeriodRange;
  generatedAt: Date;
  kurators: KuratorSummaryRow[];
  kuratorsByType: KuratorSummaryByType;
  courseSections: CourseMatrixSection[];
};

function normalizeCourseType(category: string | null | undefined): 'online' | 'offline' | null {
  const value = (category ?? '').trim().toLowerCase();
  if (value === 'online' || value === 'onlayn') return 'online';
  if (value === 'offline' || value === 'ofline' || value === 'oflayn') return 'offline';
  return null;
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

function computeTestPresetPeriod(preset: TestReportPreset, now: Date): PeriodRange {
  const todayStart = startOfTashkentDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const localToday = toTashkentDate(todayStart);
  const weekday = localToday.getDay(); // 0 Sun .. 6 Sat
  const diffToMonday = (weekday + 6) % 7;
  const thisWeekStartLocal = new Date(localToday.getFullYear(), localToday.getMonth(), localToday.getDate() - diffToMonday);
  const thisWeekStart = fromTashkentDate(thisWeekStartLocal);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const thisMonthStartLocal = new Date(localToday.getFullYear(), localToday.getMonth(), 1);
  const thisMonthStart = fromTashkentDate(thisMonthStartLocal);
  const nextMonthStartLocal = new Date(localToday.getFullYear(), localToday.getMonth() + 1, 1);
  const nextMonthStart = fromTashkentDate(nextMonthStartLocal);
  const lastMonthStartLocal = new Date(localToday.getFullYear(), localToday.getMonth() - 1, 1);
  const lastMonthStart = fromTashkentDate(lastMonthStartLocal);

  if (preset === 'today') {
    return { kind: 'daily', from: todayStart, to: tomorrowStart, fromLabel: toYmd(todayStart), toLabel: toYmd(todayStart) };
  }
  if (preset === 'yesterday') {
    const from = addDays(todayStart, -1);
    return { kind: 'daily', from, to: todayStart, fromLabel: toYmd(from), toLabel: toYmd(from) };
  }
  if (preset === 'this_week') {
    return {
      kind: 'weekly',
      from: thisWeekStart,
      to: tomorrowStart,
      fromLabel: toYmd(thisWeekStart),
      toLabel: toYmd(addDays(tomorrowStart, -1)),
    };
  }
  if (preset === 'last_week') {
    return {
      kind: 'weekly',
      from: lastWeekStart,
      to: thisWeekStart,
      fromLabel: toYmd(lastWeekStart),
      toLabel: toYmd(addDays(thisWeekStart, -1)),
    };
  }
  if (preset === 'this_month') {
    return {
      kind: 'monthly',
      from: thisMonthStart,
      to: tomorrowStart,
      fromLabel: toYmd(thisMonthStart),
      toLabel: toYmd(addDays(tomorrowStart, -1)),
    };
  }
  return {
    kind: 'monthly',
    from: lastMonthStart,
    to: thisMonthStart,
    fromLabel: toYmd(lastMonthStart),
    toLabel: toYmd(addDays(thisMonthStart, -1)),
  };
}

function isMissingCourseEndDateColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('courses.enddate') && message.includes('does not exist');
  }
  return message.includes('courses.enddate');
}

function activeCourseWindowForPeriod(period: PeriodRange): Record<string, unknown> {
  return {
    isActive: true,
    startDate: { lte: period.to },
    OR: [{ endDate: null }, { endDate: { gte: period.from } }],
  };
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

async function buildKuratorSummaryByType(tenantId: string, period: PeriodRange): Promise<KuratorSummaryByType> {
  const loadRows = async (useEndDateFilter: boolean) => {
    const courseWhere = useEndDateFilter
      ? activeCourseWindowForPeriod(period)
      : { isActive: true, startDate: { lte: period.to } };
    return Promise.all([
      prisma.user.findMany({
        where: { tenantId, roles: { has: 'Kurator' }, isActive: true },
        select: { id: true, name: true, username: true },
        orderBy: [{ name: 'asc' }, { username: 'asc' }],
      }),
      prisma.kuratorAssignment.findMany({
        where: {
          tenantId,
          isActive: true,
          courseRun: { course: courseWhere as any },
        },
        select: {
          kuratorUserId: true,
          customerId: true,
          courseRun: { select: { course: { select: { category: true } } } },
        },
      }),
      prisma.classAttendance.findMany({
        where: {
          tenantId,
          attended: false,
          lessonDate: { gte: period.from, lt: period.to },
          courseRun: { course: courseWhere as any },
        },
        select: {
          customerId: true,
          courseRun: { select: { course: { select: { category: true } } } },
        },
      }),
      prisma.studentExerciseLog.findMany({
        where: {
          tenantId,
          completedAt: { gte: period.from, lt: period.to },
          exerciseDefinition: { course: courseWhere as any },
        },
        select: {
          customerId: true,
          exerciseDefinition: { select: { course: { select: { category: true } } } },
        },
      }),
    ]);
  };
  const [kurators, assignments, missedRows, activityRows] = await loadRows(true).catch(async (error) => {
    if (!isMissingCourseEndDateColumnError(error)) {
      throw error;
    }
    return loadRows(false);
  });

  const customerToKuratorsByType = {
    online: new Map<string, Set<string>>(),
    offline: new Map<string, Set<string>>(),
  };
  const studentsByKuratorByType = {
    online: new Map<string, Set<string>>(),
    offline: new Map<string, Set<string>>(),
  };

  for (const row of assignments) {
    const courseType = normalizeCourseType(row.courseRun.course.category);
    if (!courseType) continue;

    const customerToKurators = customerToKuratorsByType[courseType];
    const studentsByKurator = studentsByKuratorByType[courseType];

    const kuratorSet = customerToKurators.get(row.customerId) ?? new Set<string>();
    kuratorSet.add(row.kuratorUserId);
    customerToKurators.set(row.customerId, kuratorSet);

    const studentSet = studentsByKurator.get(row.kuratorUserId) ?? new Set<string>();
    studentSet.add(row.customerId);
    studentsByKurator.set(row.kuratorUserId, studentSet);
  }

  const missedByKuratorByType = {
    online: new Map<string, number>(),
    offline: new Map<string, number>(),
  };
  for (const row of missedRows) {
    const courseType = normalizeCourseType(row.courseRun.course.category);
    if (!courseType) continue;

    const customerToKurators = customerToKuratorsByType[courseType];
    const missedByKurator = missedByKuratorByType[courseType];
    const kuratorSet = customerToKurators.get(row.customerId) ?? new Set<string>();
    for (const kuratorId of kuratorSet) {
      missedByKurator.set(kuratorId, (missedByKurator.get(kuratorId) ?? 0) + 1);
    }
  }

  const activeStudentsByKuratorByType = {
    online: new Map<string, Set<string>>(),
    offline: new Map<string, Set<string>>(),
  };
  for (const row of activityRows) {
    const courseType = normalizeCourseType(row.exerciseDefinition.course.category);
    if (!courseType) continue;

    const customerToKurators = customerToKuratorsByType[courseType];
    const activeStudentsByKurator = activeStudentsByKuratorByType[courseType];
    const kuratorSet = customerToKurators.get(row.customerId) ?? new Set<string>();
    for (const kuratorId of kuratorSet) {
      const activeSet = activeStudentsByKurator.get(kuratorId) ?? new Set<string>();
      activeSet.add(row.customerId);
      activeStudentsByKurator.set(kuratorId, activeSet);
    }
  }

  const buildRows = (courseType: 'online' | 'offline'): KuratorSummaryRow[] => {
    const studentsByKurator = studentsByKuratorByType[courseType];
    const activeStudentsByKurator = activeStudentsByKuratorByType[courseType];
    const missedByKurator = missedByKuratorByType[courseType];

    return kurators
      .map((kurator) => {
        const studentCount = studentsByKurator.get(kurator.id)?.size ?? 0;
        const completed = activeStudentsByKurator.get(kurator.id)?.size ?? 0;
        const pending = Math.max(0, studentCount - completed);
        const total = completed + pending;
        return {
          name: kurator.name ?? kurator.username ?? 'Kurator',
          studentCount,
          completedTasks: completed,
          pendingTasks: pending,
          missedStudents: missedByKurator.get(kurator.id) ?? 0,
          performancePercent: total > 0 ? Math.round((completed / total) * 100) : 0,
        };
      })
      .filter((row) => row.studentCount > 0 || row.completedTasks > 0 || row.pendingTasks > 0 || row.missedStudents > 0);
  };

  const online = buildRows('online');
  const offline = buildRows('offline');
  const allMap = new Map<string, KuratorSummaryRow>();
  for (const row of [...online, ...offline]) {
    const current = allMap.get(row.name);
    if (!current) {
      allMap.set(row.name, { ...row });
      continue;
    }
    const completed = current.completedTasks + row.completedTasks;
    const pending = current.pendingTasks + row.pendingTasks;
    const total = completed + pending;
    allMap.set(row.name, {
      name: row.name,
      studentCount: current.studentCount + row.studentCount,
      completedTasks: completed,
      pendingTasks: pending,
      missedStudents: current.missedStudents + row.missedStudents,
      performancePercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    });
  }

  return {
    online,
    offline,
    all: Array.from(allMap.values()),
  };
}

async function buildCourseSections(tenantId: string, period: PeriodRange): Promise<CourseMatrixSection[]> {
  const courses = await prisma.course.findMany({
    where: {
      tenantId,
      ...(activeCourseWindowForPeriod(period) as any),
    },
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
  }).catch(async (error) => {
    if (!isMissingCourseEndDateColumnError(error)) {
      throw error;
    }
    return prisma.course.findMany({
      where: { tenantId, isActive: true, startDate: { lte: period.to } },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    });
  });

  const sections: CourseMatrixSection[] = [];
  const eligibleCourses = courses
    .map((course) => ({
      ...course,
      reportType: normalizeCourseType(course.category),
    }))
    .filter((course): course is (typeof course & { reportType: 'online' | 'offline' }) => course.reportType !== null);

  for (const course of eligibleCourses) {
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
      select: { id: true, name: true },
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
        practicePoints,
        totalPoints,
      };
    });

    sections.push({
      courseType: course.reportType,
      courseName: course.name,
      practiceNames: practices.map((row) => row.name),
      rows,
    });
  }

  return sections;
}

async function buildTenantReport(tenantId: string, period: PeriodRange): Promise<TenantReport> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const [kuratorsByType, courseSections] = await Promise.all([
    buildKuratorSummaryByType(tenant.id, period),
    buildCourseSections(tenant.id, period),
  ]);

  const kurators = kuratorsByType.all;

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    period,
    generatedAt: new Date(),
    kurators,
    kuratorsByType,
    courseSections,
  };
}

async function sendTenantReportToReceivers(tenantId: string, period: PeriodRange): Promise<{
  recipients: number;
  sent: number;
  failed: number;
}> {
  const receivers = await prisma.telegramReportReceiver.findMany({
    where: {
      tenantId,
      isActive: true,
    },
    select: { id: true, chatId: true },
  });

  if (receivers.length === 0) {
    return { recipients: 0, sent: 0, failed: 0 };
  }

  const report = await buildTenantReport(tenantId, period);
  const pdf = await renderReportPdf(report);
  const caption = `Hisobot: ${period.kind} (${period.fromLabel} .. ${period.toLabel})`;
  const filename = `hisobot-${period.kind}-${period.fromLabel}-${period.toLabel}.pdf`;

  let sent = 0;
  let failed = 0;
  for (const receiver of receivers) {
    const recipient = receiver.chatId;
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

  return { recipients: receivers.length, sent, failed };
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
    const result = await sendTenantReportToReceivers(tenant.id, period);
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

  const from = update?.message?.from ?? null;
  const chat = update?.message?.chat ?? null;
  const usernameRaw = from?.username ?? chat?.username ?? null;
  const username = typeof usernameRaw === 'string' && usernameRaw.trim().length > 0 ? usernameRaw.trim() : null;
  const firstName = typeof from?.first_name === 'string' ? from.first_name.trim() : '';
  const lastName = typeof from?.last_name === 'string' ? from.last_name.trim() : '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const title = typeof chat?.title === 'string' ? chat.title.trim() : '';
  const telegramName = fullName || title || (username ? `@${username}` : null);
  const chatId = String(chatIdRaw);

  try {
    await prisma.$transaction(async (tx) => {
      const marked = await tx.telegramLinkToken.updateMany({
        where: {
          id: link.id,
          usedAt: null,
          expiresAt: { gte: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (marked.count !== 1) {
        throw new Error('TOKEN_ALREADY_USED_OR_EXPIRED');
      }

      await tx.telegramReportReceiver.upsert({
        where: {
          tenantId_chatId: {
            tenantId: link.tenantId,
            chatId,
          },
        },
        create: {
          tenantId: link.tenantId,
          chatId,
          username,
          telegramName,
          createdByUserId: user.id,
          isActive: true,
        },
        update: {
          username,
          telegramName,
          createdByUserId: user.id,
          isActive: true,
        },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'TOKEN_ALREADY_USED_OR_EXPIRED') {
      await sendTelegramMessage(chatId, 'Token yaroqsiz yoki muddati tugagan. Yangi token oling.');
      return { handled: true, message: 'Invalid token (race safe)' };
    }
    throw error;
  }

  await sendTelegramMessage(
    chatId,
    `Ulanish muvaffaqiyatli. ${user.name ?? user.username ?? 'Admin'} uchun hisobotlar shu chatga yuboriladi.`,
  );
  return { handled: true, message: 'Linked' };
}

export async function getTelegramReportStatus(tenantId: string): Promise<{
  configured: boolean;
  timezone: string;
  botUsername: string | null;
  receivers: Array<{
    id: string;
    chatId: string;
    username: string | null;
    telegramName: string | null;
    createdAt: Date;
    createdByName: string | null;
    createdByUserId: string;
  }>;
}> {
  const botConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
  const receivers = await prisma.telegramReportReceiver.findMany({
    where: {
      tenantId,
      isActive: true,
    },
    select: {
      id: true,
      chatId: true,
      username: true,
      telegramName: true,
      createdAt: true,
      createdByUserId: true,
      createdByUser: { select: { name: true, username: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return {
    configured: botConfigured,
    timezone: process.env.REPORT_TIMEZONE || DEFAULT_TIMEZONE,
    botUsername: process.env.TELEGRAM_BOT_USERNAME?.trim() || null,
    receivers: receivers.map((receiver) => ({
      id: receiver.id,
      chatId: receiver.chatId,
      username: receiver.username ?? null,
      telegramName: receiver.telegramName ?? null,
      createdAt: receiver.createdAt,
      createdByUserId: receiver.createdByUserId,
      createdByName: receiver.createdByUser.name ?? receiver.createdByUser.username ?? null,
    })),
  };
}

export async function sendTelegramTestReport(
  tenantId: string,
  userId: string,
  preset: TestReportPreset,
): Promise<{ sent: boolean; recipient: string; period: PeriodRange }> {
  ensureTelegramConfigured();
  const admin = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId,
      isActive: true,
      roles: { has: 'Admin' },
    },
    select: { id: true },
  });
  if (!admin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Faqat faol admin test yubora oladi" });
  }

  const receiver = await prisma.telegramReportReceiver.findFirst({
    where: {
      tenantId,
      createdByUserId: userId,
      isActive: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    select: { chatId: true },
  });
  if (!receiver?.chatId) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "Siz uchun telegram receiver bog'lanmagan" });
  }

  const period = computeTestPresetPeriod(preset, new Date());
  const report = await buildTenantReport(tenantId, period);
  const pdf = await renderReportPdf(report);
  await sendTelegramDocument(
    receiver.chatId,
    `hisobot-test-${period.fromLabel}.pdf`,
    pdf,
    `Test hisobot (${period.fromLabel} .. ${period.toLabel})`,
  );
  return { sent: true, recipient: receiver.chatId, period };
}

export async function deleteTelegramReceiver(tenantId: string, receiverId: string): Promise<{ deleted: boolean }> {
  const existing = await prisma.telegramReportReceiver.findFirst({
    where: { id: receiverId, tenantId, isActive: true },
    select: { id: true },
  });
  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Receiver topilmadi' });
  }

  await prisma.telegramReportReceiver.delete({
    where: { id: receiverId },
  });
  return { deleted: true };
}

export function getTelegramWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}
