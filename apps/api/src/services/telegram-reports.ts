import crypto from 'crypto';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { renderReportPdf } from './telegram-report-pdf';
import {
  visibleCourseRunWhere,
  visibleExerciseDefinitionWhere,
  withCourseRunVisibilityFallback,
  withExerciseDefinitionVisibilityFallback,
} from '../utils/prisma-visibility';

const TASHKENT_OFFSET_MINUTES = 5 * 60;
const DEFAULT_TIMEZONE = 'Asia/Tashkent';
const LINK_TOKEN_TTL_MINUTES = 30;

export type ReportPeriodKind = 'daily' | 'weekly' | 'monthly';
export type TestReportPreset = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month';
export type ReportAudience = 'admin_manager' | 'curators';
export type CuratorScheduleSlot = 'noon' | 'evening';

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

type AllowedLinkRole = 'Admin' | 'Manager' | 'Kurator' | 'Bosh Kurator';
const ALLOWED_LINK_ROLES: AllowedLinkRole[] = ['Admin', 'Manager', 'Kurator', 'Bosh Kurator'];
const ADMIN_MANAGER_ROLES: Array<'Admin' | 'Manager' | 'Bosh Kurator'> = ['Admin', 'Manager', 'Bosh Kurator'];

function hasAllowedLinkRole(roles: string[]): boolean {
  return roles.some((role) => ALLOWED_LINK_ROLES.includes(role as AllowedLinkRole));
}

function normalizeCourseType(category: string | null | undefined): 'online' | 'offline' | null {
  const value = (category ?? '').trim().toLowerCase();
  if (value === 'online' || value === 'onlayn') return 'online';
  if (value === 'offline' || value === 'ofline' || value === 'oflayn') return 'offline';
  return null;
}

function getCourseTypeAliases(courseType: 'online' | 'offline'): string[] {
  return courseType === 'online' ? ['online', 'onlayn'] : ['offline', 'ofline', 'oflayn'];
}

function calculatePerformancePercent(params: {
  completedTasks: number;
  pendingTasks: number;
  attendedLessons: number;
  totalLessons: number;
  exerciseLogs: number;
}): number {
  const { completedTasks, pendingTasks, attendedLessons, totalLessons, exerciseLogs } = params;
  const taskTotal = completedTasks + pendingTasks;
  const taskRate = taskTotal > 0 ? (completedTasks / taskTotal) * 100 : 0;
  const attendanceRate = totalLessons > 0 ? (attendedLessons / totalLessons) * 100 : 0;
  const activityRate = Math.min(100, exerciseLogs * 10);
  if (taskTotal === 0 && totalLessons === 0 && exerciseLogs === 0) {
    return 0;
  }
  return Math.round(taskRate * 0.4 + attendanceRate * 0.5 + activityRate * 0.1);
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

function requireTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'TELEGRAM_BOT_TOKEN sozlanmagan' });
  }
  return token;
}

async function telegramApiCall<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = requireTelegramBotToken();
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
  const token = requireTelegramBotToken();
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
  type InternalKuratorSummaryRow = KuratorSummaryRow & {
    _attendedLessons: number;
    _totalLessons: number;
    _exerciseLogs: number;
  };

  const loadRows = async (useEndDateFilter: boolean) => {
    const courseWhere = useEndDateFilter
      ? activeCourseWindowForPeriod(period)
      : { isActive: true, startDate: { lte: period.to } };
    const [kurators, assignments] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId, roles: { hasSome: ['Kurator', 'Bosh Kurator'] }, isActive: true },
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
    ]);
    return { kurators, assignments };
  };
  const { kurators, assignments } = await loadRows(true).catch(async (error) => {
    if (!isMissingCourseEndDateColumnError(error)) {
      throw error;
    }
    return loadRows(false);
  });

  const studentsByKuratorByType = {
    online: new Map<string, Set<string>>(),
    offline: new Map<string, Set<string>>(),
  };

  for (const row of assignments) {
    const courseType = normalizeCourseType(row.courseRun.course.category);
    if (!courseType) continue;

    const studentsByKurator = studentsByKuratorByType[courseType];

    const studentSet = studentsByKurator.get(row.kuratorUserId) ?? new Set<string>();
    studentSet.add(row.customerId);
    studentsByKurator.set(row.kuratorUserId, studentSet);
  }

  const buildRows = async (courseType: 'online' | 'offline'): Promise<InternalKuratorSummaryRow[]> => {
    const courseTypeAliases = getCourseTypeAliases(courseType);
    const studentsByKurator = studentsByKuratorByType[courseType];
    const kuratorIds = kurators.map((kurator) => kurator.id);
    const uniqueStudentIds = Array.from(new Set(Array.from(studentsByKurator.values()).flatMap((set) => Array.from(set))));
    if (kuratorIds.length === 0 || uniqueStudentIds.length === 0) {
      return [];
    }

    const [completedTaskRows, pendingTaskRows, attendanceTotals, attendanceAttended, exerciseRows] = await Promise.all([
      prisma.kuratorTask.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          customerId: { in: uniqueStudentIds },
          completedAt: { gte: period.from, lt: period.to },
        },
        _count: { id: true },
      }),
      prisma.kuratorTask.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          customerId: { in: uniqueStudentIds },
          completedAt: null,
          createdAt: { gte: period.from, lt: period.to },
        },
        _count: { id: true },
      }),
      prisma.classAttendance.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          customerId: { in: uniqueStudentIds },
          lessonDate: { gte: period.from, lt: period.to },
          courseRun: { course: { category: { in: courseTypeAliases } } },
        } as any,
        _count: { id: true },
      } as any),
      prisma.classAttendance.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          customerId: { in: uniqueStudentIds },
          lessonDate: { gte: period.from, lt: period.to },
          attended: true,
          courseRun: { course: { category: { in: courseTypeAliases } } },
        } as any,
        _count: { id: true },
      } as any),
      prisma.studentExerciseLog.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          customerId: { in: uniqueStudentIds },
          completedAt: { gte: period.from, lt: period.to },
          exerciseDefinition: { course: { category: { in: courseTypeAliases } } },
        } as any,
        _count: { id: true },
      } as any),
    ]);

    const extractCount = (row: any): number =>
      row && row._count && typeof row._count === 'object' ? Number(row._count.id ?? 0) : 0;

    const completedTaskMap = new Map(completedTaskRows.map((row) => [row.customerId, extractCount(row)]));
    const pendingTaskMap = new Map(pendingTaskRows.map((row) => [row.customerId, extractCount(row)]));
    const attendanceTotalMap = new Map(attendanceTotals.map((row) => [row.customerId, extractCount(row)]));
    const attendanceAttendedMap = new Map(attendanceAttended.map((row) => [row.customerId, extractCount(row)]));
    const exerciseMap = new Map(exerciseRows.map((row) => [row.customerId, extractCount(row)]));

    return kurators
      .map((kurator): InternalKuratorSummaryRow => {
        const studentIds = Array.from(studentsByKurator.get(kurator.id) ?? []);
        let completedTasks = 0;
        let pendingTasks = 0;
        let attendedLessons = 0;
        let totalLessons = 0;
        let exerciseLogs = 0;
        let missedStudents = 0;

        for (const studentId of studentIds) {
          completedTasks += completedTaskMap.get(studentId) ?? 0;
          pendingTasks += pendingTaskMap.get(studentId) ?? 0;
          const studentAttendanceTotal = attendanceTotalMap.get(studentId) ?? 0;
          const studentAttendanceAttended = attendanceAttendedMap.get(studentId) ?? 0;
          attendedLessons += studentAttendanceAttended;
          totalLessons += studentAttendanceTotal;
          exerciseLogs += exerciseMap.get(studentId) ?? 0;
          if (studentAttendanceTotal > 0 && studentAttendanceAttended < studentAttendanceTotal) {
            missedStudents += 1;
          }
        }

        return {
          name: kurator.name ?? kurator.username ?? 'Kurator',
          studentCount: studentIds.length,
          completedTasks,
          pendingTasks,
          missedStudents,
          performancePercent: calculatePerformancePercent({
            completedTasks,
            pendingTasks,
            attendedLessons,
            totalLessons,
            exerciseLogs,
          }),
          _attendedLessons: attendedLessons,
          _totalLessons: totalLessons,
          _exerciseLogs: exerciseLogs,
        };
      })
      .filter((row) => row.studentCount > 0 || row.completedTasks > 0 || row.pendingTasks > 0 || row.missedStudents > 0);
  };

  const [onlineInternal, offlineInternal] = await Promise.all([buildRows('online'), buildRows('offline')]);
  const stripInternal = (row: InternalKuratorSummaryRow): KuratorSummaryRow => ({
    name: row.name,
    studentCount: row.studentCount,
    completedTasks: row.completedTasks,
    pendingTasks: row.pendingTasks,
    missedStudents: row.missedStudents,
    performancePercent: row.performancePercent,
  });
  const online = onlineInternal.map(stripInternal);
  const offline = offlineInternal.map(stripInternal);

  const allMap = new Map<string, InternalKuratorSummaryRow>();
  for (const row of [...onlineInternal, ...offlineInternal]) {
    const current = allMap.get(row.name);
    if (!current) {
      allMap.set(row.name, { ...row });
      continue;
    }
    const completedTasks = current.completedTasks + row.completedTasks;
    const pendingTasks = current.pendingTasks + row.pendingTasks;
    const attendedLessons = current._attendedLessons + row._attendedLessons;
    const totalLessons = current._totalLessons + row._totalLessons;
    const exerciseLogs = current._exerciseLogs + row._exerciseLogs;
    allMap.set(row.name, {
      name: row.name,
      studentCount: current.studentCount + row.studentCount,
      completedTasks,
      pendingTasks,
      missedStudents: current.missedStudents + row.missedStudents,
      performancePercent: calculatePerformancePercent({
        completedTasks,
        pendingTasks,
        attendedLessons,
        totalLessons,
        exerciseLogs,
      }),
      _attendedLessons: attendedLessons,
      _totalLessons: totalLessons,
      _exerciseLogs: exerciseLogs,
    });
  }

  return {
    online,
    offline,
    all: Array.from(allMap.values()).map(stripInternal),
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
    const [practices, activeRuns] = await Promise.all([
      withExerciseDefinitionVisibilityFallback((withVisibilityColumns) =>
        prisma.exerciseDefinition.findMany({
          where: {
            tenantId,
            courseId: course.id,
            isActive: true,
            ...visibleExerciseDefinitionWhere(withVisibilityColumns),
          },
          select: { id: true, name: true, type: true },
          orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
        }),
      ),
      withCourseRunVisibilityFallback((withHiddenColumn) =>
        prisma.courseRun.findMany({
          where: {
            tenantId,
            courseId: course.id,
            ...visibleCourseRunWhere(withHiddenColumn),
            startDate: { lte: period.to },
            endDate: { gte: period.from },
          },
          select: { id: true },
        }),
      ),
    ]);

    const runIds = activeRuns.map((run) => run.id);
    if (runIds.length === 0) continue;

    const [runMembers, assignments] = await Promise.all([
      prisma.courseRunMember.findMany({
        where: {
          tenantId,
          courseRunId: { in: runIds },
        },
        select: { customerId: true },
      }),
      prisma.kuratorAssignment.findMany({
        where: {
          tenantId,
          courseRunId: { in: runIds },
          isActive: true,
        },
        select: { customerId: true },
      }),
    ]);

    const studentIds = Array.from(
      new Set([...runMembers.map((row) => row.customerId), ...assignments.map((row) => row.customerId)]),
    );
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
      createdByUser: {
        isActive: true,
        roles: { hasSome: ADMIN_MANAGER_ROLES },
      },
    },
    select: { id: true, chatId: true, createdByUserId: true },
  });

  if (receivers.length === 0) {
    console.warn(JSON.stringify({ level: 'warn', event: 'telegram_schedule_no_receivers', tenantId, audience: 'admin_manager' }));
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

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'telegram_admin_manager_report_delivery',
      tenantId,
      periodKind: period.kind,
      recipients: receivers.length,
      sent,
      failed,
    }),
  );

  return { recipients: receivers.length, sent, failed };
}

async function sendTenantCuratorSummaries(
  tenantId: string,
  now: Date,
  slot: CuratorScheduleSlot,
): Promise<{ recipients: number; sent: number; failed: number }> {
  const dayStart = startOfTashkentDay(now);
  const dayEnd = addDays(dayStart, 1);

  const receivers = await prisma.telegramReportReceiver.findMany({
    where: {
      tenantId,
      isActive: true,
      createdByUser: {
        isActive: true,
        roles: { has: 'Kurator' },
      },
    },
    select: {
      chatId: true,
      createdByUserId: true,
      createdByUser: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  });

  if (receivers.length === 0) {
    console.warn(JSON.stringify({ level: 'warn', event: 'telegram_schedule_no_receivers', tenantId, audience: 'curators', slot }));
    return { recipients: 0, sent: 0, failed: 0 };
  }

  const uniqueKuratorIds = Array.from(new Set(receivers.map((receiver) => receiver.createdByUserId)));
  const assignments = await prisma.kuratorAssignment.findMany({
    where: {
      tenantId,
      isActive: true,
      kuratorUserId: { in: uniqueKuratorIds },
      courseRun: {
        startDate: { lte: now },
        endDate: { gte: dayStart },
      },
    },
    select: {
      kuratorUserId: true,
      customerId: true,
    },
  });

  const assignedStudentsByKurator = new Map<string, Set<string>>();
  for (const row of assignments) {
    const set = assignedStudentsByKurator.get(row.kuratorUserId) ?? new Set<string>();
    set.add(row.customerId);
    assignedStudentsByKurator.set(row.kuratorUserId, set);
  }

  const allAssignedCustomerIds = Array.from(
    new Set(assignments.map((row) => row.customerId).filter((id): id is string => Boolean(id))),
  );

  const [exerciseLogs, attendanceLogs] = await Promise.all([
    allAssignedCustomerIds.length > 0
      ? prisma.studentExerciseLog.findMany({
          where: {
            tenantId,
            customerId: { in: allAssignedCustomerIds },
            completedAt: { gte: dayStart, lt: dayEnd },
          },
          select: { customerId: true },
        })
      : Promise.resolve([] as Array<{ customerId: string }>),
    allAssignedCustomerIds.length > 0
      ? prisma.classAttendance.findMany({
          where: {
            tenantId,
            customerId: { in: allAssignedCustomerIds },
            lessonDate: { gte: dayStart, lt: dayEnd },
          },
          select: { customerId: true, attended: true },
        })
      : Promise.resolve([] as Array<{ customerId: string; attended: boolean }>),
  ]);

  const completedCustomers = new Set(exerciseLogs.map((row) => row.customerId));
  const attendanceByCustomer = new Map<string, { keldi: number; kelmadi: number }>();
  for (const row of attendanceLogs) {
    const current = attendanceByCustomer.get(row.customerId) ?? { keldi: 0, kelmadi: 0 };
    if (row.attended) current.keldi += 1;
    else current.kelmadi += 1;
    attendanceByCustomer.set(row.customerId, current);
  }

  const slotLabel = slot === 'noon' ? '12:00' : '18:00';
  let sent = 0;
  let failed = 0;
  for (const receiver of receivers) {
    const kuratorId = receiver.createdByUserId;
    const students = assignedStudentsByKurator.get(kuratorId) ?? new Set<string>();
    const studentCount = students.size;
    let completed = 0;
    let keldi = 0;
    let kelmadi = 0;
    for (const studentId of students) {
      if (completedCustomers.has(studentId)) completed += 1;
      const attendance = attendanceByCustomer.get(studentId);
      if (attendance) {
        keldi += attendance.keldi;
        kelmadi += attendance.kelmadi;
      }
    }
    const pending = Math.max(0, studentCount - completed);

    const kuratorName = receiver.createdByUser.name ?? receiver.createdByUser.username ?? 'Kurator';
    const text =
      `Kurator hisobot (${slotLabel})\n` +
      `Sana: ${toYmd(dayStart)}\n` +
      `Kurator: ${kuratorName}\n` +
      `Biriktirilgan o'quvchilar: ${studentCount}\n` +
      `Amaliy bajarganlar: ${completed}\n` +
      `Amaliy bajarilmaganlar: ${pending}\n` +
      `Davomat keldi: ${keldi}\n` +
      `Davomat kelmadi: ${kelmadi}`;

    try {
      await sendTelegramMessage(receiver.chatId, text);
      sent += 1;
      await prisma.reportDeliveryLog.create({
        data: {
          tenantId,
          periodKind: `curator_${slot}`,
          dateFrom: dayStart,
          dateTo: now,
          recipient: receiver.chatId,
          status: 'sent',
        },
      });
    } catch (error) {
      failed += 1;
      await prisma.reportDeliveryLog.create({
        data: {
          tenantId,
          periodKind: `curator_${slot}`,
          dateFrom: dayStart,
          dateTo: now,
          recipient: receiver.chatId,
          status: 'failed',
          error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        },
      });
    }
  }

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'telegram_curator_summary_delivery',
      tenantId,
      slot,
      recipients: receivers.length,
      sent,
      failed,
    }),
  );
  return { recipients: receivers.length, sent, failed };
}

type TelegramSchedulerJobKey =
  | 'admin_manager_daily'
  | 'admin_manager_weekly'
  | 'admin_manager_monthly'
  | 'curator_noon'
  | 'curator_evening';

type TelegramScheduledSlot = {
  jobKey: TelegramSchedulerJobKey;
  slotTime: Date;
  params: {
    kind: ReportPeriodKind;
    audience: ReportAudience;
    slot?: CuratorScheduleSlot;
  };
};

function truncateToLocalMinute(localDate: Date): Date {
  return new Date(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
    localDate.getHours(),
    localDate.getMinutes(),
    0,
    0,
  );
}

function localSlotToUtc(localDay: Date, hour: number): Date {
  return fromTashkentDate(
    new Date(localDay.getFullYear(), localDay.getMonth(), localDay.getDate(), hour, 0, 0, 0),
  );
}

function uniqueBySlot(slots: TelegramScheduledSlot[]): TelegramScheduledSlot[] {
  const seen = new Set<string>();
  const out: TelegramScheduledSlot[] = [];
  for (const slot of slots) {
    const key = `${slot.jobKey}:${slot.slotTime.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
  }
  return out;
}

const inMemorySchedulerLocks = new Map<string, number>();
const IN_MEMORY_LOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function slotLockKey(slot: TelegramScheduledSlot): string {
  return `${slot.jobKey}:${slot.slotTime.toISOString()}`;
}

function cleanupInMemorySchedulerLocks(nowMs: number): void {
  for (const [key, createdAtMs] of inMemorySchedulerLocks.entries()) {
    if (nowMs - createdAtMs > IN_MEMORY_LOCK_TTL_MS) {
      inMemorySchedulerLocks.delete(key);
    }
  }
}

function claimInMemorySchedulerLock(slot: TelegramScheduledSlot): boolean {
  const nowMs = Date.now();
  cleanupInMemorySchedulerLocks(nowMs);
  const key = slotLockKey(slot);
  if (inMemorySchedulerLocks.has(key)) {
    return false;
  }
  inMemorySchedulerLocks.set(key, nowMs);
  return true;
}

function isMissingScheduleRunTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('telegram_schedule_runs') && message.includes('does not exist');
  }
  return message.includes('telegram_schedule_runs');
}

export function resolveDueTelegramScheduleSlots(now: Date): TelegramScheduledSlot[] {
  const lookbackHoursRaw = Number(process.env.TELEGRAM_INTERNAL_SCHEDULER_LOOKBACK_HOURS ?? 36);
  const lookbackHours = Number.isFinite(lookbackHoursRaw) ? Math.max(1, Math.min(168, Math.floor(lookbackHoursRaw))) : 36;

  const localNow = truncateToLocalMinute(toTashkentDate(now));
  const localLookback = new Date(localNow.getTime() - lookbackHours * 60 * 60 * 1000);
  const startDay = new Date(localLookback.getFullYear(), localLookback.getMonth(), localLookback.getDate());
  const endDay = new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate());

  const slots: TelegramScheduledSlot[] = [];
  for (let day = new Date(startDay); day <= endDay; day = addDays(day, 1)) {
    const candidates: TelegramScheduledSlot[] = [
      {
        jobKey: 'admin_manager_daily',
        slotTime: localSlotToUtc(day, 8),
        params: { kind: 'daily', audience: 'admin_manager' },
      },
      {
        jobKey: 'curator_noon',
        slotTime: localSlotToUtc(day, 12),
        params: { kind: 'daily', audience: 'curators', slot: 'noon' },
      },
      {
        jobKey: 'curator_evening',
        slotTime: localSlotToUtc(day, 18),
        params: { kind: 'daily', audience: 'curators', slot: 'evening' },
      },
    ];

    if (day.getDay() === 1) {
      candidates.push({
        jobKey: 'admin_manager_weekly',
        slotTime: localSlotToUtc(day, 8),
        params: { kind: 'weekly', audience: 'admin_manager' },
      });
    }
    if (day.getDate() === 1) {
      candidates.push({
        jobKey: 'admin_manager_monthly',
        slotTime: localSlotToUtc(day, 8),
        params: { kind: 'monthly', audience: 'admin_manager' },
      });
    }

    for (const slot of candidates) {
      const localSlot = truncateToLocalMinute(toTashkentDate(slot.slotTime));
      if (localSlot <= localNow && localSlot >= localLookback) {
        slots.push(slot);
      }
    }
  }

  return uniqueBySlot(slots).sort((a, b) => a.slotTime.getTime() - b.slotTime.getTime());
}

const STALE_RUNNING_SLOT_MINUTES = 20;

async function reclaimStaleRunningSlot(slot: TelegramScheduledSlot, now: Date): Promise<{ id: string } | null> {
  const existing = await prisma.telegramScheduleRun.findUnique({
    where: {
      jobKey_slotTime: {
        jobKey: slot.jobKey,
        slotTime: slot.slotTime,
      },
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  if (!existing) return null;
  if (existing.status !== 'running' || existing.finishedAt) return null;

  const staleBefore = new Date(now.getTime() - STALE_RUNNING_SLOT_MINUTES * 60_000);
  if (existing.startedAt > staleBefore) {
    return null;
  }

  const claimed = await prisma.telegramScheduleRun.updateMany({
    where: {
      id: existing.id,
      status: 'running',
      finishedAt: null,
    },
    data: {
      startedAt: now,
      error: `reclaimed_stale_run_previous_started_at=${existing.startedAt.toISOString()}`,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return { id: existing.id };
}

export async function processDueTelegramScheduledSlots(now: Date = new Date()): Promise<{
  checked: number;
  claimed: number;
  skipped: number;
  sent: number;
  failed: number;
}> {
  requireTelegramBotToken();
  const slots = resolveDueTelegramScheduleSlots(now);
  let claimed = 0;
  let skipped = 0;
  let sent = 0;
  let failed = 0;
  let schedulerLockMode: 'db' | 'memory' = 'db';

  for (const slot of slots) {
    let scheduleRunId: string | null = null;
    if (schedulerLockMode === 'db') {
      try {
        const proposedId = crypto.randomUUID();
        const created = await prisma.telegramScheduleRun.createMany({
          data: {
            id: proposedId,
            jobKey: slot.jobKey,
            slotTime: slot.slotTime,
            status: 'running',
          },
          skipDuplicates: true,
        });
        if (created.count === 1) {
          scheduleRunId = proposedId;
          claimed += 1;
          console.log(
            JSON.stringify({
              level: 'info',
              event: 'slot_claimed',
              mode: 'db',
              jobKey: slot.jobKey,
              slotTime: slot.slotTime.toISOString(),
            }),
          );
        } else {
          const reclaimed = await reclaimStaleRunningSlot(slot, new Date());
          if (!reclaimed) {
            skipped += 1;
            console.log(
              JSON.stringify({
                level: 'info',
                event: 'slot_skipped_already_claimed',
                mode: 'db',
                jobKey: slot.jobKey,
                slotTime: slot.slotTime.toISOString(),
              }),
            );
            continue;
          }
          scheduleRunId = reclaimed.id;
          claimed += 1;
          console.log(
            JSON.stringify({
              level: 'warn',
              event: 'slot_reclaimed_stale_running',
              mode: 'db',
              jobKey: slot.jobKey,
              slotTime: slot.slotTime.toISOString(),
              staleAfterMinutes: STALE_RUNNING_SLOT_MINUTES,
            }),
          );
        }
      } catch (error) {
        if (isMissingScheduleRunTableError(error)) {
          schedulerLockMode = 'memory';
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'telegram_scheduler_lock_fallback_memory',
              message:
                'telegram_schedule_runs table is missing. Scheduler continues in single-instance memory mode until migration is deployed.',
            }),
          );
        } else {
          throw error;
        }
      }
    }

    if (schedulerLockMode === 'memory' && !scheduleRunId) {
      const memoryClaimed = claimInMemorySchedulerLock(slot);
      if (!memoryClaimed) {
        skipped += 1;
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'slot_skipped_already_claimed',
            mode: 'memory',
            jobKey: slot.jobKey,
            slotTime: slot.slotTime.toISOString(),
          }),
        );
        continue;
      }
      claimed += 1;
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'slot_claimed',
          mode: 'memory',
          jobKey: slot.jobKey,
          slotTime: slot.slotTime.toISOString(),
        }),
      );
    }

    try {
      const result = await runTelegramScheduledReports({
        kind: slot.params.kind,
        audience: slot.params.audience,
        slot: slot.params.slot,
        now: slot.slotTime,
      });

      const slotFailed = result.failed > 0;
      if (slotFailed) {
        failed += 1;
      } else {
        sent += 1;
      }

      if (scheduleRunId) {
        await prisma.telegramScheduleRun.update({
          where: { id: scheduleRunId },
          data: {
            status: slotFailed ? 'failed' : 'sent',
            error: slotFailed ? `failed_recipients=${result.failed}` : null,
            finishedAt: new Date(),
          },
        });
      }

      console.log(
        JSON.stringify({
          level: slotFailed ? 'warn' : 'info',
          event: slotFailed ? 'slot_failed' : 'slot_sent',
          mode: scheduleRunId ? 'db' : 'memory',
          jobKey: slot.jobKey,
          slotTime: slot.slotTime.toISOString(),
          recipients: result.recipients,
          sentRecipients: result.sent,
          failedRecipients: result.failed,
        }),
      );
    } catch (error) {
      failed += 1;
      if (scheduleRunId) {
        await prisma.telegramScheduleRun.update({
          where: { id: scheduleRunId },
          data: {
            status: 'failed',
            error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
            finishedAt: new Date(),
          },
        });
      }
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'slot_failed',
          mode: scheduleRunId ? 'db' : 'memory',
          jobKey: slot.jobKey,
          slotTime: slot.slotTime.toISOString(),
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return {
    checked: slots.length,
    claimed,
    skipped,
    sent,
    failed,
  };
}

export function validateCronSecret(provided: string | null | undefined): boolean {
  const expected = process.env.REPORT_CRON_SECRET?.trim();
  if (!expected) return false;
  return provided === expected;
}

export async function runTelegramScheduledReports(params: {
  kind: ReportPeriodKind;
  now?: Date;
  audience?: ReportAudience;
  slot?: CuratorScheduleSlot;
}): Promise<{
  period: PeriodRange;
  tenants: number;
  recipients: number;
  sent: number;
  failed: number;
}> {
  requireTelegramBotToken();
  const now = params.now ?? new Date();
  const audience = params.audience ?? 'admin_manager';
  const slot = params.slot ?? 'noon';
  const kind = params.kind;
  const period =
    audience === 'curators'
      ? {
          kind: 'daily' as ReportPeriodKind,
          from: startOfTashkentDay(now),
          to: now,
          fromLabel: toYmd(startOfTashkentDay(now)),
          toLabel: toYmd(now),
        }
      : computePreviousPeriod(kind, now);
  const tenants = await prisma.tenant.findMany({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  let recipients = 0;
  let sent = 0;
  let failed = 0;

  for (const tenant of tenants) {
    const result =
      audience === 'curators'
        ? await sendTenantCuratorSummaries(tenant.id, now, slot)
        : await sendTenantReportToReceivers(tenant.id, period);
    recipients += result.recipients;
    sent += result.sent;
    failed += result.failed;
  }

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'telegram_scheduled_reports_finished',
      audience,
      slot: audience === 'curators' ? slot : null,
      periodKind: kind,
      tenants: tenants.length,
      recipients,
      sent,
      failed,
    }),
  );

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
    },
    select: { id: true, roles: true },
  });
  if (!user || !hasAllowedLinkRole(user.roles)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: "Faqat faol admin, menejer yoki kurator Telegram bog'lay oladi",
    });
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
  requireTelegramBotToken();
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
    },
    select: { id: true, name: true, username: true, roles: true },
  });
  if (!user || !hasAllowedLinkRole(user.roles)) {
    await sendTelegramMessage(String(chatIdRaw), "Bu token uchun foydalanuvchi topilmadi yoki huquqi yo'q.");
    return { handled: true, message: 'Linked user not allowed' };
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
    `Ulanish muvaffaqiyatli. ${user.name ?? user.username ?? 'Foydalanuvchi'} uchun hisobotlar shu chatga yuboriladi.`,
  );
  return { handled: true, message: 'Linked' };
}

export async function getTelegramReportStatus(tenantId: string): Promise<{
  configured: boolean;
  timezone: string;
  botUsername: string | null;
  lastAdminManagerDelivery: {
    periodKind: string;
    dateFrom: Date;
    dateTo: Date;
    sent: number;
    failed: number;
    createdAt: Date;
  } | null;
  lastCuratorDelivery: {
    periodKind: string;
    dateFrom: Date;
    dateTo: Date;
    sent: number;
    failed: number;
    createdAt: Date;
  } | null;
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
  const [receivers, latestAdminManagerLog, latestCuratorLog] = await Promise.all([
    prisma.telegramReportReceiver.findMany({
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
    }),
    prisma.reportDeliveryLog.findFirst({
      where: {
        tenantId,
        periodKind: { in: ['daily', 'weekly', 'monthly'] },
      },
      orderBy: [{ createdAt: 'desc' }],
      select: { periodKind: true, dateFrom: true, dateTo: true, createdAt: true },
    }),
    prisma.reportDeliveryLog.findFirst({
      where: {
        tenantId,
        periodKind: { in: ['curator_noon', 'curator_evening'] },
      },
      orderBy: [{ createdAt: 'desc' }],
      select: { periodKind: true, dateFrom: true, dateTo: true, createdAt: true },
    }),
  ]);

  const summarizeDelivery = async (seed: { periodKind: string; dateFrom: Date; dateTo: Date; createdAt: Date } | null) => {
    if (!seed) return null;
    const rows = await prisma.reportDeliveryLog.findMany({
      where: {
        tenantId,
        periodKind: seed.periodKind,
        dateFrom: seed.dateFrom,
        dateTo: seed.dateTo,
      },
      select: { status: true },
    });
    const sent = rows.filter((row) => row.status === 'sent').length;
    const failed = rows.filter((row) => row.status === 'failed').length;
    return {
      periodKind: seed.periodKind,
      dateFrom: seed.dateFrom,
      dateTo: seed.dateTo,
      sent,
      failed,
      createdAt: seed.createdAt,
    };
  };

  const [lastAdminManagerDelivery, lastCuratorDelivery] = await Promise.all([
    summarizeDelivery(latestAdminManagerLog),
    summarizeDelivery(latestCuratorLog),
  ]);

  return {
    configured: botConfigured,
    timezone: process.env.REPORT_TIMEZONE || DEFAULT_TIMEZONE,
    botUsername: process.env.TELEGRAM_BOT_USERNAME?.trim() || null,
    lastAdminManagerDelivery,
    lastCuratorDelivery,
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

export async function getTelegramSelfStatus(tenantId: string, userId: string): Promise<{
  configured: boolean;
  timezone: string;
  botUsername: string | null;
  receiver: {
    chatId: string;
    username: string | null;
    telegramName: string | null;
    createdAt: Date;
  } | null;
}> {
  const botConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
  const receiver = await prisma.telegramReportReceiver.findFirst({
    where: {
      tenantId,
      createdByUserId: userId,
      isActive: true,
    },
    select: {
      chatId: true,
      username: true,
      telegramName: true,
      createdAt: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return {
    configured: botConfigured,
    timezone: process.env.REPORT_TIMEZONE || DEFAULT_TIMEZONE,
    botUsername: process.env.TELEGRAM_BOT_USERNAME?.trim() || null,
    receiver: receiver
      ? {
          chatId: receiver.chatId,
          username: receiver.username ?? null,
          telegramName: receiver.telegramName ?? null,
          createdAt: receiver.createdAt,
        }
      : null,
  };
}

export async function sendTelegramTestReport(
  tenantId: string,
  userId: string,
  preset: TestReportPreset,
): Promise<{ sent: boolean; recipient: string; period: PeriodRange }> {
  requireTelegramBotToken();
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      tenantId,
      isActive: true,
    },
    select: { id: true, roles: true },
  });
  if (!user || !user.roles.some((role) => role === 'Admin' || role === 'Manager' || role === 'Bosh Kurator')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Faqat faol admin yoki menejer test yubora oladi" });
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
