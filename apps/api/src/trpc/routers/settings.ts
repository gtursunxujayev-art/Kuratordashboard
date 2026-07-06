import jwt from 'jsonwebtoken';
import { router, adminProcedure, managerProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma, type Prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { hashPassword } from '../../services/auth/password';
import { startOfDayLocal } from '../../utils/date-local';
import {
  createTelegramLinkToken,
  deleteTelegramReceiver,
  getTelegramReportStatus,
  getTelegramSelfStatus,
  sendTelegramTestReport,
} from '../../services/telegram-reports';

const scheduleTemplateSchema = z.object({
  id: z.string().optional(),
  courseCategory: z.string().min(1).max(100),
  durationWeeks: z.number().int().min(1).max(52),
  baseLessons: z.number().int().min(1).max(200),
  premiumExtraLessons: z.number().int().min(0).max(50),
});

const SCHEDULE_TEMPLATES_SETTINGS_KEY = 'scheduleTemplates';
const KURATOR_ASSIGNABLE_ROLES = ['Kurator', 'Bosh Kurator'] as const;
const STAFF_MANAGED_ROLES = ['Manager', 'Kurator', 'Bosh Kurator'] as const;

type ScheduleTemplateFallbackRow = {
  id: string;
  tenantId: string;
  courseCategory: string;
  durationWeeks: number;
  baseLessons: number;
  premiumExtraLessons: number;
  createdAt: Date;
  updatedAt: Date;
};

function toIntOrDefault(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.trunc(n);
}

function toDateOrNow(value: unknown): Date {
  const d = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function isAssignableKuratorWhere() {
  return { hasSome: [...KURATOR_ASSIGNABLE_ROLES] };
}

function isManagedStaffWhere() {
  return { hasSome: [...STAFF_MANAGED_ROLES] };
}

function ensureEndedForHide(endDate: Date): void {
  if (endDate.getTime() >= Date.now()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Faqat tugagan oqimni yashirish mumkin',
    });
  }
}

function readScheduleTemplatesFromSettings(
  settings: unknown,
  tenantId: string,
): ScheduleTemplateFallbackRow[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return [];
  }

  const raw = (settings as Record<string, unknown>)[SCHEDULE_TEMPLATES_SETTINGS_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      const category = String(row.courseCategory || '').trim();
      if (!category) {
        return null;
      }
      return {
        id: String(row.id || `fallback-${tenantId}-${category.toLowerCase()}-${index}`),
        tenantId: String(row.tenantId || tenantId),
        courseCategory: category,
        durationWeeks: Math.max(1, Math.min(52, toIntOrDefault(row.durationWeeks, 6))),
        baseLessons: Math.max(1, Math.min(200, toIntOrDefault(row.baseLessons, 12))),
        premiumExtraLessons: Math.max(0, Math.min(50, toIntOrDefault(row.premiumExtraLessons, 2))),
        createdAt: toDateOrNow(row.createdAt),
        updatedAt: toDateOrNow(row.updatedAt),
      };
    })
    .filter((row): row is ScheduleTemplateFallbackRow => Boolean(row));
}

function writeScheduleTemplatesToSettings(
  settings: unknown,
  templates: ScheduleTemplateFallbackRow[],
): Record<string, unknown> {
  const base =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? { ...(settings as Record<string, unknown>) }
      : {};

  base[SCHEDULE_TEMPLATES_SETTINGS_KEY] = templates.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    courseCategory: row.courseCategory,
    durationWeeks: row.durationWeeks,
    baseLessons: row.baseLessons,
    premiumExtraLessons: row.premiumExtraLessons,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return base;
}

function isMissingRegionConfigsTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('region_configs') && message.includes('does not exist');
  }
  return message.includes('region_configs');
}

function isMissingCustomerRegionColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('customers.region') && message.includes('does not exist');
  }
  return message.includes('customers.region');
}

function isMissingCustomerGenderColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('customers.gender') && message.includes('does not exist');
  }
  return message.includes('customers.gender');
}

function isMissingCourseRunsTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('course_runs') && message.includes('does not exist');
  }
  return message.includes('course_runs');
}

function isMissingCourseRunMembersTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('course_run_members') && message.includes('does not exist');
  }
  return message.includes('course_run_members');
}

function isMissingCourseStartDateColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('courses.startdate') && message.includes('does not exist');
  }
  return message.includes('courses.startdate');
}

function isMissingCourseRunHiddenColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return (
      (message.includes('course_runs.ishidden') || message.includes('courserun.ishidden'))
      && message.includes('does not exist')
    );
  }
  return message.includes('course_runs.ishidden') || message.includes('courserun.ishidden');
}

function isMissingExerciseDefinitionVisibilityColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return (
      (
        message.includes('exercise_definitions.ishidden')
        || message.includes('exercisedefinition.ishidden')
        || message.includes('exercise_definitions.startdate')
        || message.includes('exercisedefinition.startdate')
      )
      && message.includes('does not exist')
    );
  }
  return (
    message.includes('exercise_definitions.ishidden')
    || message.includes('exercisedefinition.ishidden')
    || message.includes('exercise_definitions.startdate')
    || message.includes('exercisedefinition.startdate')
  );
}

function isMissingCourseScheduleTemplatesTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('course_schedule_templates') && message.includes('does not exist');
  }
  return message.includes('course_schedule_templates');
}

function isScheduleTemplatesStorageError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();

  if (isMissingCourseScheduleTemplatesTableError(error)) {
    return true;
  }

  // Handle partially migrated or drifted schema around schedule templates.
  if (code === 'P2022' && (message.includes('course_schedule_templates') || message.includes('coursescheduletemplate'))) {
    return true;
  }
  if (code === 'P2010' && (message.includes('course_schedule_templates') || message.includes('coursescheduletemplate'))) {
    return true;
  }
  if (message.includes('course_schedule_templates')) {
    return true;
  }

  return false;
}

function throwMissingCourseRunsMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      "Oqim sozlamalari uchun DB migratsiya qo'llanmagan (`course_runs`). Avval migration deploy qiling.",
  });
}

function throwMissingCourseStartDateMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      "Kurs boshlanish sanasi ustuni topilmadi (`courses.startDate`). Avval migration deploy qiling.",
  });
}

function throwMissingVisibilityMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      "Yashirish funksiyasi uchun DB migratsiya qo'llanmagan (`isHidden`). Avval migration deploy qiling.",
  });
}

function throwMissingExerciseStartDateMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      "Mashq boshlanish sanasi uchun DB migratsiya qo'llanmagan (`exercise_definitions.startDate`). Avval migration deploy qiling.",
  });
}

function throwMissingRegionsMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      "Region sozlamalari uchun DB migratsiya qo'llanmagan (`region_configs`). Avval migration deploy qiling.",
  });
}

function normalizeCourseCategory(value: string): 'online' | 'intensiv' | 'offline' | 'additional_service' {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.includes('additional')
    || normalized.includes("qo'shimcha")
    || normalized.includes("qo‘shimcha")
    || normalized.includes('xizmat')
    || normalized.includes('servis')
    || normalized.includes('service')
  ) {
    return 'additional_service';
  }
  if (normalized.includes('intens')) return 'intensiv';
  if (normalized.includes('online') || normalized.includes('onlayn')) return 'online';
  return 'offline';
}

function requiredStartDayByCategory(category: string): 1 | 6 | null {
  const normalized = normalizeCourseCategory(category);
  if (normalized === 'additional_service') return null;
  return normalized === 'online' ? 1 : 6;
}

function requiredStartDayLabel(day: 1 | 6): string {
  return day === 1 ? 'dushanba' : 'shanba';
}

function computeEndDate(startDate: Date, durationWeeks: number, courseCategory: string): Date {
  // Online starts Monday, Offline/Intensiv starts Saturday.
  // Additional-service courses can start any day and span full calendar weeks from that day.
  const requiredDay = requiredStartDayByCategory(courseCategory);
  const dayOffset =
    requiredDay === null
      ? (durationWeeks * 7 - 1)
      : (requiredDay === 1 ? (durationWeeks * 7 - 1) : (durationWeeks * 7 - 6));
  const end = new Date(startDate);
  end.setDate(end.getDate() + dayOffset);
  return end;
}

function parseLocalDateInput(value: string, fieldLabel: string): Date {
  const raw = value.trim();
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${fieldLabel} noto'g'ri formatda`,
    });
  }
  return parsed;
}

function normalizeDateToLocalStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function calculateDurationWeeksFromDates(startDate: Date, endDate: Date): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const start = normalizeDateToLocalStart(startDate);
  const end = normalizeDateToLocalStart(endDate);
  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  return Math.max(1, Math.ceil(inclusiveDays / 7));
}

function normalizeOptional(input?: string): string | undefined {
  const value = input?.trim();
  return value ? value : undefined;
}

function normalizeColorHex(input: string): string {
  const raw = input.trim().toUpperCase();
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;

  if (!/^#[0-9A-F]{6}$/.test(withHash)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Rang HEX formatida bo\'lishi kerak (#RRGGBB)',
    });
  }

  return withHash;
}

function isUniqueViolation(error: unknown): boolean {
  return String((error as { code?: string })?.code || '') === 'P2002';
}

function isIncorrectBinaryBindParameterError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '');
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return (
    message.includes('incorrect binary data format in bind parameter')
    || message.includes('code: "22p03"')
    || (code === 'P2010' && message.includes('22p03'))
  );
}

function throwFractionalPointsMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      "Amaliy ball ustuni eski turda qolgan. `allow_fractional_amaliy_points` migratsiyasini deploy qiling.",
  });
}

async function resolveRunMemberCounts(params: {
  tenantId: string;
  runs: Array<{ id: string; courseId: string }>;
}): Promise<Map<string, number>> {
  const { tenantId, runs } = params;
  const counts = new Map<string, number>();
  if (runs.length === 0) return counts;

  const membersByRun = new Map<string, Set<string>>();
  const memberRows = await prisma.courseRunMember.findMany({
    where: { tenantId, courseRunId: { in: runs.map((run) => run.id) } },
    select: { courseRunId: true, customerId: true },
  });

  for (const row of memberRows) {
    const set = membersByRun.get(row.courseRunId) ?? new Set<string>();
    set.add(row.customerId);
    membersByRun.set(row.courseRunId, set);
  }

  for (const [runId, members] of membersByRun) {
    counts.set(runId, members.size);
  }

  for (const runId of runs.map((run) => run.id)) {
    if (!counts.has(runId)) counts.set(runId, 0);
  }

  return counts;
}

type SettingsTransaction = Prisma.TransactionClient;

async function lockCourseRoster(
  tx: SettingsTransaction,
  tenantId: string,
  courseId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`course-roster:${tenantId}:${courseId}`}))`;
}

async function replaceCourseRunRoster(params: {
  tx: SettingsTransaction;
  tenantId: string;
  courseId: string;
  courseRunId: string;
  customerIds: string[];
}): Promise<void> {
  const { tx, tenantId, courseId, courseRunId, customerIds } = params;
  await lockCourseRoster(tx, tenantId, courseId);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const targetRun = await tx.courseRun.findFirst({
    where: { id: courseRunId, tenantId, courseId },
    select: { endDate: true },
  });
  if (!targetRun) throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });

  if (customerIds.length > 0 && targetRun.endDate >= today) {
    const conflictingMemberships = await tx.courseRunMember.findMany({
      where: {
        tenantId,
        customerId: { in: customerIds },
        courseRunId: { not: courseRunId },
        courseRun: {
          courseId,
          endDate: { gte: today },
        },
      },
      select: { courseRunId: true, customerId: true },
    });
    if (conflictingMemberships.length > 0) {
      await tx.courseRunMember.deleteMany({
        where: {
          tenantId,
          OR: conflictingMemberships.map((row) => ({
            courseRunId: row.courseRunId,
            customerId: row.customerId,
          })),
        },
      });
      await tx.kuratorAssignment.updateMany({
        where: {
          tenantId,
          isActive: true,
          OR: conflictingMemberships.map((row) => ({
            courseRunId: row.courseRunId,
            customerId: row.customerId,
          })),
        },
        data: { isActive: false },
      });
    }
  }

  await tx.courseRunMember.deleteMany({ where: { tenantId, courseRunId } });
  if (customerIds.length > 0) {
    await tx.courseRunMember.createMany({
      data: customerIds.map((customerId) => ({ tenantId, courseRunId, customerId })),
      skipDuplicates: true,
    });
  }
}

async function validateRosterEligibility(
  tenantId: string,
  courseId: string,
  customerIds: string[],
): Promise<void> {
  if (customerIds.length === 0) return;
  const eligible = await prisma.income.findMany({
    where: {
      tenantId,
      courseId,
      customerId: { in: customerIds },
      type: 'new_sale',
      lifecycleStatus: 'active',
    },
    select: { customerId: true },
    distinct: ['customerId'],
  });
  if (eligible.length !== customerIds.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Tanlangan o'quvchilarning ba'zilari ushbu kursda faol emas",
    });
  }
}

export const settingsRouter = router({
  listStaffUsers: adminProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        roles: isManagedStaffWhere(),
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        roles: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }),

  createStaffUser: adminProcedure
    .input(
      z.object({
        role: z.enum(['Manager', 'Kurator', 'Bosh Kurator']),
        name: z.string().max(160).optional(),
        username: z.string().max(80).optional(),
        email: z.string().email().max(160).optional(),
        phone: z.string().max(30).optional(),
        password: z.string().min(6).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const username = normalizeOptional(input.username);
      const email = normalizeOptional(input.email)?.toLowerCase();
      const phone = normalizeOptional(input.phone);
      const name = normalizeOptional(input.name);

      if (!username && !email && !phone) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Kamida bitta login maydoni kerak (username, email yoki telefon)",
        });
      }

      const passwordHash = await hashPassword(input.password);

      try {
        return await prisma.user.create({
          data: {
            tenantId: ctx.tenantId,
            username,
            email,
            phone,
            name,
            passwordHash,
            roles: [input.role],
            authProvider: 'password',
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            phone: true,
            roles: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: "Username, email yoki telefon allaqachon mavjud",
          });
        }
        throw error;
      }
  }),

  updateStaffUserName: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        name: z.string().max(160).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name = normalizeOptional(input.name);

      const existing = await prisma.user.findFirst({
        where: {
          id: input.userId,
          tenantId: ctx.tenantId,
          roles: isManagedStaffWhere(),
        },
        select: { id: true },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "Foydalanuvchi topilmadi" });
      }

      return prisma.user.update({
        where: { id: input.userId },
        data: {
          name: name ?? null,
        },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          phone: true,
          roles: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
    }),

  listRegions: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await prisma.regionConfig.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      if (!isMissingRegionConfigsTableError(error)) {
        throw error;
      }
      try {
        const customerRegions = await prisma.customer.findMany({
          where: {
            tenantId: ctx.tenantId,
            region: { not: null },
          },
          select: { region: true },
          distinct: ['region'],
          orderBy: { region: 'asc' },
        });

        return customerRegions
          .map((row) => row.region?.trim())
          .filter((region): region is string => Boolean(region))
          .map((name) => ({
            id: `legacy-${name}`,
            tenantId: ctx.tenantId,
            name,
            isActive: true,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }));
      } catch (fallbackError) {
        if (!isMissingCustomerRegionColumnError(fallbackError)) {
          throw fallbackError;
        }
        return [];
      }
    }
  }),

  addRegion: adminProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const existing = await prisma.regionConfig.findFirst({
          where: { tenantId: ctx.tenantId, name: input.name },
        });
        if (existing) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Bu nom allaqachon mavjud' });
        }
        return prisma.regionConfig.create({
          data: { tenantId: ctx.tenantId, name: input.name },
        });
      } catch (error) {
        if (isMissingRegionConfigsTableError(error)) {
          throwMissingRegionsMigrationError();
        }
        throw error;
      }
    }),

  updateRegion: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const existing = await prisma.regionConfig.findFirst({
          where: { id: input.id, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Viloyat topilmadi' });
        }

        const { id, ...data } = input;
        return prisma.regionConfig.update({
          where: { id },
          data,
        });
      } catch (error) {
        if (isMissingRegionConfigsTableError(error)) {
          throwMissingRegionsMigrationError();
        }
        throw error;
      }
  }),

  listScheduleTemplates: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await prisma.courseScheduleTemplate.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { courseCategory: 'asc' },
      });
    } catch (error) {
      if (isScheduleTemplatesStorageError(error)) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: ctx.tenantId },
          select: { settings: true },
        });
        return readScheduleTemplatesFromSettings(tenant?.settings, ctx.tenantId).sort((a, b) =>
          a.courseCategory.localeCompare(b.courseCategory),
        );
      }
      throw error;
    }
  }),

  upsertScheduleTemplate: adminProcedure
    .input(scheduleTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const normalizedCategory = input.courseCategory.trim();
      try {
        if (input.id) {
          const existingById = await prisma.courseScheduleTemplate.findFirst({
            where: { id: input.id, tenantId: ctx.tenantId },
            select: { id: true },
          });
          if (!existingById) {
            throw new TRPCError({ code: 'NOT_FOUND', message: "Jadval shabloni topilmadi" });
          }
          return await prisma.courseScheduleTemplate.update({
            where: { id: input.id },
            data: {
              courseCategory: normalizedCategory,
              durationWeeks: input.durationWeeks,
              baseLessons: input.baseLessons,
              premiumExtraLessons: input.premiumExtraLessons,
              updatedAt: new Date(),
            },
          });
        }

        return await prisma.courseScheduleTemplate.upsert({
          where: {
            tenantId_courseCategory: {
              tenantId: ctx.tenantId,
              courseCategory: normalizedCategory,
            },
          },
          create: {
            tenantId: ctx.tenantId,
            courseCategory: normalizedCategory,
            durationWeeks: input.durationWeeks,
            baseLessons: input.baseLessons,
            premiumExtraLessons: input.premiumExtraLessons,
          },
          update: {
            durationWeeks: input.durationWeeks,
            baseLessons: input.baseLessons,
            premiumExtraLessons: input.premiumExtraLessons,
            updatedAt: new Date(),
          },
        });
      } catch (error) {
        if (isScheduleTemplatesStorageError(error)) {
          const tenant = await prisma.tenant.findUnique({
            where: { id: ctx.tenantId },
            select: { settings: true },
          });
          const now = new Date();
          const templates = readScheduleTemplatesFromSettings(tenant?.settings, ctx.tenantId);
          const normalizedCategoryKey = normalizedCategory.toLowerCase();
          const existingIndex = input.id
            ? templates.findIndex((row) => row.id === input.id)
            : templates.findIndex((row) => row.courseCategory.trim().toLowerCase() === normalizedCategoryKey);

          let saved: ScheduleTemplateFallbackRow;
          if (existingIndex >= 0) {
            const current = templates[existingIndex];
            saved = {
              ...current,
              courseCategory: normalizedCategory,
              durationWeeks: input.durationWeeks,
              baseLessons: input.baseLessons,
              premiumExtraLessons: input.premiumExtraLessons,
              updatedAt: now,
            };
            templates[existingIndex] = saved;
          } else {
            saved = {
              id: input.id || `fallback-${ctx.tenantId}-${normalizedCategoryKey}`,
              tenantId: ctx.tenantId,
              courseCategory: normalizedCategory,
              durationWeeks: input.durationWeeks,
              baseLessons: input.baseLessons,
              premiumExtraLessons: input.premiumExtraLessons,
              createdAt: now,
              updatedAt: now,
            };
            templates.push(saved);
          }

          await prisma.tenant.update({
            where: { id: ctx.tenantId },
            data: {
              settings: writeScheduleTemplatesToSettings(
                tenant?.settings,
                templates,
              ) as Prisma.InputJsonValue,
            },
          });

          return saved;
        }
        throw error;
      }
    }),

  listCourseRuns: protectedProcedure.query(async ({ ctx }) => {
    const loadRuns = (withHiddenColumn: boolean) =>
      prisma.courseRun.findMany({
        where: { tenantId: ctx.tenantId },
        select: {
          id: true,
          tenantId: true,
          courseId: true,
          name: true,
          startDate: true,
          endDate: true,
          durationWeeks: true,
          baseLessons: true,
          premiumExtraLessons: true,
          kuratorUserId: true,
          ...(withHiddenColumn ? { isHidden: true } : {}),
          createdAt: true,
          updatedAt: true,
          course: { select: { name: true, category: true } },
          kurator: { select: { id: true, name: true, username: true } },
        },
        orderBy: { startDate: 'desc' },
      });

    try {
      let supportsHiddenColumn = true;
      let runs: Awaited<ReturnType<typeof loadRuns>>;

      try {
        runs = await loadRuns(true);
      } catch (error) {
        if (!isMissingCourseRunHiddenColumnError(error)) {
          throw error;
        }
        supportsHiddenColumn = false;
        runs = await loadRuns(false);
      }

      const memberCounts = await resolveRunMemberCounts({
        tenantId: ctx.tenantId,
        runs: runs.map((run) => ({ id: run.id, courseId: run.courseId })),
      });

      return runs.map((run) => ({
        ...run,
        isHidden: supportsHiddenColumn ? Boolean((run as any).isHidden) : false,
        studentCount: memberCounts.get(run.id) ?? 0,
      }));
    } catch (error) {
      if (!isMissingCourseRunsTableError(error)) {
        throw error;
      }
      return [];
    }
  }),

  createCourseRun: managerProcedure
    .input(
      z.object({
        courseId: z.string(),
        name: z.string().min(1).max(200),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        durationWeeks: z.number().int().min(1).max(52).optional(),
        baseLessons: z.number().int().min(1).max(200).optional(),
        premiumExtraLessons: z.number().int().min(0).max(50).optional(),
        // Explicit roster. Empty means the run has no assigned students.
        customerIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, tenantId: ctx.tenantId },
        select: { id: true, category: true },
      });
      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi' });
      }

      let defaultCourseStart: Date | null = null;
      let defaultCourseEnd: Date | null = null;
      try {
        const rows = await prisma.$queryRaw<Array<{ startDate: Date | string | null; endDate: Date | string | null }>>`
          SELECT "startDate", "endDate"
          FROM "courses"
          WHERE "id" = ${input.courseId}
            AND "tenantId" = ${ctx.tenantId}
          LIMIT 1
        `;

        const rawStartDate = rows[0]?.startDate ?? null;
        const rawEndDate = rows[0]?.endDate ?? null;
        if (rawStartDate) {
          const parsed = rawStartDate instanceof Date ? rawStartDate : new Date(String(rawStartDate));
          if (!Number.isNaN(parsed.getTime())) {
            defaultCourseStart = normalizeDateToLocalStart(parsed);
          }
        }
        if (rawEndDate) {
          const parsed = rawEndDate instanceof Date ? rawEndDate : new Date(String(rawEndDate));
          if (!Number.isNaN(parsed.getTime())) {
            defaultCourseEnd = normalizeDateToLocalStart(parsed);
          }
        }
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        if (isMissingCourseStartDateColumnError(error)) {
          throwMissingCourseStartDateMigrationError();
        }
        throw error;
      }

      const start = input.startDate
        ? parseLocalDateInput(input.startDate, "Boshlanish sanasi")
        : defaultCourseStart;

      if (!start || Number.isNaN(start.getTime())) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Kursning boshlanish sanasi topilmadi. Avval kurs start date ni kiriting.",
        });
      }
      const requiredStartDay = requiredStartDayByCategory(course.category);
      if (requiredStartDay !== null && start.getDay() !== requiredStartDay) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Kursning boshlanish sanasi ${requiredStartDayLabel(requiredStartDay)} kuni bo'lishi kerak`,
        });
      }

      let template: { durationWeeks: number; baseLessons: number; premiumExtraLessons: number } | null = null;
      try {
        template = await prisma.courseScheduleTemplate.findFirst({
          where: { tenantId: ctx.tenantId, courseCategory: course.category },
          select: { durationWeeks: true, baseLessons: true, premiumExtraLessons: true },
        });
      } catch (error) {
        if (!isMissingCourseScheduleTemplatesTableError(error)) {
          throw error;
        }
      }

      const durationWeeks = input.durationWeeks ?? template?.durationWeeks ?? 6;
      const baseLessons = input.baseLessons ?? template?.baseLessons ?? 12;
      const premiumExtraLessons = input.premiumExtraLessons ?? template?.premiumExtraLessons ?? 2;
      const computedEndDate = computeEndDate(start, durationWeeks, course.category);
      const endDate = input.endDate
        ? parseLocalDateInput(input.endDate, 'Tugash sanasi')
        : (defaultCourseEnd ?? computedEndDate);

      if (endDate.getTime() < start.getTime()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas",
        });
      }
      const durationWeeksFromDates = calculateDurationWeeksFromDates(start, endDate);

      const rosterIds = Array.from(new Set(input.customerIds ?? []));
      await validateRosterEligibility(ctx.tenantId, input.courseId, rosterIds);

      try {
        return await prisma.$transaction(async (tx) => {
          await lockCourseRoster(tx, ctx.tenantId, input.courseId);
          const created = await tx.courseRun.create({
            data: {
              tenantId: ctx.tenantId,
              courseId: input.courseId,
              name: input.name,
              startDate: start,
              endDate,
              durationWeeks: durationWeeksFromDates,
              baseLessons,
              premiumExtraLessons,
            },
          });
          await replaceCourseRunRoster({
            tx,
            tenantId: ctx.tenantId,
            courseId: input.courseId,
            courseRunId: created.id,
            customerIds: rosterIds,
          });
          return created;
        }, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (isMissingCourseRunsTableError(error)) {
          throwMissingCourseRunsMigrationError();
        }
        throw error;
      }
    }),

  updateCourseRun: managerProcedure
    .input(
      z.object({
        courseRunId: z.string(),
        name: z.string().min(1).max(200).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        durationWeeks: z.number().int().min(1).max(52).optional(),
        baseLessons: z.number().int().min(1).max(200).optional(),
        premiumExtraLessons: z.number().int().min(0).max(50).optional(),
        // Replace the run's roster wholesale. When omitted, roster is left untouched.
        // When provided as [], the roster is cleared.
        customerIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.courseRun
        .findFirst({
          where: { id: input.courseRunId, tenantId: ctx.tenantId },
          include: {
            course: {
              select: {
                category: true,
              },
            },
          },
        })
        .catch((error) => {
          if (isMissingCourseRunsTableError(error)) {
            throwMissingCourseRunsMigrationError();
          }
          throw error;
        });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }

      const nextStartDate = input.startDate
        ? parseLocalDateInput(input.startDate, "Boshlanish sanasi")
        : existing.startDate;

      const hasDateInput = input.startDate !== undefined || input.endDate !== undefined;
      let nextEndDate = input.endDate
        ? parseLocalDateInput(input.endDate, 'Tugash sanasi')
        : existing.endDate;

      if (!hasDateInput && input.durationWeeks !== undefined) {
        nextEndDate = computeEndDate(nextStartDate, input.durationWeeks, existing.course.category);
      }

      if (nextEndDate.getTime() < nextStartDate.getTime()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas",
        });
      }

      const requiredStartDay = requiredStartDayByCategory(existing.course.category);
      if (requiredStartDay !== null && nextStartDate.getDay() !== requiredStartDay) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Kursning boshlanish sanasi ${requiredStartDayLabel(requiredStartDay)} kuni bo'lishi kerak`,
        });
      }

      const nextDurationWeeks = calculateDurationWeeksFromDates(nextStartDate, nextEndDate);

      const rosterIds = input.customerIds === undefined ? null : Array.from(new Set(input.customerIds));
      if (rosterIds) await validateRosterEligibility(ctx.tenantId, existing.courseId, rosterIds);

      try {
        return await prisma.$transaction(async (tx) => {
          await lockCourseRoster(tx, ctx.tenantId, existing.courseId);
          const updated = await tx.courseRun.update({
            where: { id: input.courseRunId },
            data: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              startDate: nextStartDate,
              endDate: nextEndDate,
              durationWeeks: nextDurationWeeks,
              ...(input.baseLessons !== undefined ? { baseLessons: input.baseLessons } : {}),
              ...(input.premiumExtraLessons !== undefined
                ? { premiumExtraLessons: input.premiumExtraLessons }
                : {}),
            },
          });

          if (rosterIds !== null) {
            await replaceCourseRunRoster({
              tx,
              tenantId: ctx.tenantId,
              courseId: existing.courseId,
              courseRunId: input.courseRunId,
              customerIds: rosterIds,
            });
            await tx.kuratorAssignment.updateMany({
              where: { tenantId: ctx.tenantId, courseRunId: input.courseRunId },
              data: { isActive: false },
            });
            if (existing.kuratorUserId && rosterIds.length > 0) {
              await tx.kuratorAssignment.createMany({
                data: rosterIds.map((customerId) => ({
                  tenantId: ctx.tenantId,
                  courseRunId: input.courseRunId,
                  customerId,
                  kuratorUserId: existing.kuratorUserId!,
                  isActive: true,
                })),
                skipDuplicates: true,
              });
              await tx.kuratorAssignment.updateMany({
                where: {
                  tenantId: ctx.tenantId,
                  courseRunId: input.courseRunId,
                  kuratorUserId: existing.kuratorUserId,
                  customerId: { in: rosterIds },
                },
                data: { isActive: true },
              });
            }
          }
          return updated;
        }, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (isMissingCourseRunsTableError(error)) {
          throwMissingCourseRunsMigrationError();
        }
        throw error;
      }
    }),

  setCourseRunHidden: adminProcedure
    .input(
      z.object({
        courseRunId: z.string(),
        isHidden: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.courseRun.findFirst({
        where: { id: input.courseRunId, tenantId: ctx.tenantId },
        select: { id: true, endDate: true },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }

      if (input.isHidden) {
        ensureEndedForHide(existing.endDate);
      }

      return prisma.courseRun.update({
        where: { id: existing.id },
        data: { isHidden: input.isHidden, updatedAt: new Date() },
      }).catch((error) => {
        if (isMissingCourseRunHiddenColumnError(error)) {
          throwMissingVisibilityMigrationError();
        }
        throw error;
      });
    }),

  deleteCourseRun: managerProcedure
    .input(z.object({ courseRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.courseRun
        .findFirst({
          where: { id: input.courseRunId, tenantId: ctx.tenantId },
          select: { id: true, name: true },
        })
        .catch((error) => {
          if (isMissingCourseRunsTableError(error)) {
            throwMissingCourseRunsMigrationError();
          }
          throw error;
        });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }

      try {
        await prisma.courseRun.delete({
          where: { id: input.courseRunId },
        });
      } catch (error) {
        if (isMissingCourseRunsTableError(error)) {
          throwMissingCourseRunsMigrationError();
        }

        const code = String((error as any)?.code || '');
        if (code === 'P2003') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: "Oqimga bog'langan ma'lumotlar bor. Avval bog'liqliklarni tozalang.",
          });
        }
        throw error;
      }

      return { success: true };
    }),

  listExerciseColorOptions: protectedProcedure.query(async ({ ctx }) => {
    return prisma.exerciseColorOption.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        id: true,
        label: true,
        colorHex: true,
        orderIndex: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });
  }),

  upsertExerciseColorOption: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        label: z.string().min(1).max(80),
        colorHex: z.string().min(3).max(16),
        orderIndex: z.number().int().min(0).max(999).default(0),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const normalizedLabel = input.label.trim();
      const normalizedColorHex = normalizeColorHex(input.colorHex);

      if (input.id) {
        const existing = await prisma.exerciseColorOption.findFirst({
          where: { id: input.id, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Rang sozlamasi topilmadi' });
        }

        return prisma.exerciseColorOption.update({
          where: { id: input.id },
          data: {
            label: normalizedLabel,
            colorHex: normalizedColorHex,
            orderIndex: input.orderIndex,
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            updatedAt: new Date(),
          },
        });
      }

      return prisma.exerciseColorOption.create({
        data: {
          tenantId: ctx.tenantId,
          label: normalizedLabel,
          colorHex: normalizedColorHex,
          points: 0,
          orderIndex: input.orderIndex,
          isActive: input.isActive ?? true,
        },
      });
    }),

  setExerciseColorOptionActive: adminProcedure
    .input(
      z.object({
        id: z.string(),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.exerciseColorOption.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rang sozlamasi topilmadi' });
      }

      return prisma.exerciseColorOption.update({
        where: { id: input.id },
        data: {
          isActive: input.isActive,
          updatedAt: new Date(),
        },
      });
    }),

  listExerciseDefinitions: protectedProcedure
    .input(z.object({ courseId: z.string(), includeHidden: z.boolean().optional().default(false) }))
    .query(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi' });
      }

      const loadDefinitions = (withVisibilityColumns: boolean) =>
        prisma.exerciseDefinition.findMany({
          where: {
            tenantId: ctx.tenantId,
            courseId: input.courseId,
            ...(withVisibilityColumns && !input.includeHidden ? { isHidden: false } : {}),
          },
          select: {
            id: true,
            tenantId: true,
            courseId: true,
            name: true,
            type: true,
            targetCount: true,
            orderIndex: true,
            isActive: true,
            ...(withVisibilityColumns ? { startDate: true, isHidden: true } : {}),
            createdAt: true,
            colorPoints: {
              select: {
                id: true,
                tenantId: true,
                exerciseDefinitionId: true,
                colorOptionId: true,
                points: true,
                createdAt: true,
                updatedAt: true,
                colorOption: {
                  select: {
                    id: true,
                    label: true,
                    colorHex: true,
                    isActive: true,
                    orderIndex: true,
                  },
                },
              },
            },
          },
          orderBy: [{ type: 'asc' }, { orderIndex: 'asc' }],
        });

      let supportsVisibilityColumns = true;
      let rows: any[];

      try {
        rows = await loadDefinitions(true);
      } catch (error) {
        if (!isMissingExerciseDefinitionVisibilityColumnError(error)) {
          throw error;
        }
        supportsVisibilityColumns = false;
        rows = await loadDefinitions(false);
      }

      return rows.map((row) => ({
        ...row,
        startDate: supportsVisibilityColumns ? (row as any).startDate : null,
        isHidden: supportsVisibilityColumns ? Boolean((row as any).isHidden) : false,
        colorPoints: row.colorPoints.sort((left: any, right: any) => {
          const leftOrder = left.colorOption.orderIndex ?? 0;
          const rightOrder = right.colorOption.orderIndex ?? 0;
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
          return left.colorOption.label.localeCompare(right.colorOption.label);
        }),
      }));
    }),

  addExerciseDefinition: managerProcedure
    .input(
      z.object({
        courseId: z.string(),
        name: z.string().min(1).max(200),
        type: z.enum(['class', 'homework', 'extra']),
        targetCount: z.number().int().min(1).max(100),
        startDate: z.string().optional(),
        orderIndex: z.number().int().min(0).default(0),
        colorPoints: z.array(
          z.object({
            colorOptionId: z.string(),
            points: z.number().finite().min(0).max(10000),
          }),
        ).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [course, activeColorOptions] = await Promise.all([
        prisma.course.findFirst({
          where: {
            id: input.courseId,
            tenantId: ctx.tenantId,
            isActive: true,
          },
          select: { id: true },
        }),
        prisma.exerciseColorOption.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          select: { id: true },
          orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi' });
      }

      if (activeColorOptions.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Avval rang sozlamalarini kiriting' });
      }

      const activeColorIds = new Set(activeColorOptions.map((row) => row.id));
      const providedColorIds = new Set<string>();
      for (const row of input.colorPoints) {
        if (!activeColorIds.has(row.colorOptionId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ranglar ro\'yxati noto\'g\'ri' });
        }
        if (providedColorIds.has(row.colorOptionId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bir xil rang ikki marta kiritildi' });
        }
        providedColorIds.add(row.colorOptionId);
      }

      if (providedColorIds.size !== activeColorIds.size) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Har bir faol rang uchun ball kiriting' });
      }

      let created;
      try {
        created = await prisma.$transaction(async (tx) => {
          let supportsVisibilityColumns = true;
          let definition: {
            id: string;
            tenantId: string;
            courseId: string;
            name: string;
            type: string;
            targetCount: number;
            orderIndex: number;
            isActive: boolean;
            createdAt: Date;
            startDate?: Date | null;
            isHidden?: boolean;
          };

          try {
            definition = await tx.exerciseDefinition.create({
              data: {
                tenantId: ctx.tenantId,
                courseId: course.id,
                name: input.name,
                type: input.type,
                targetCount: input.targetCount,
                ...(input.startDate
                  ? { startDate: parseLocalDateInput(input.startDate, "Mashq boshlanish sanasi") }
                  : {}),
                orderIndex: input.orderIndex,
              },
              select: {
                id: true,
                tenantId: true,
                courseId: true,
                name: true,
                type: true,
                targetCount: true,
                orderIndex: true,
                isActive: true,
                startDate: true,
                isHidden: true,
                createdAt: true,
              },
            });
          } catch (error) {
            if (!isMissingExerciseDefinitionVisibilityColumnError(error)) {
              throw error;
            }
            if (input.startDate) {
              throwMissingExerciseStartDateMigrationError();
            }
            supportsVisibilityColumns = false;
            definition = await tx.exerciseDefinition.create({
              data: {
                tenantId: ctx.tenantId,
                courseId: course.id,
                name: input.name,
                type: input.type,
                targetCount: input.targetCount,
                orderIndex: input.orderIndex,
              },
              select: {
                id: true,
                tenantId: true,
                courseId: true,
                name: true,
                type: true,
                targetCount: true,
                orderIndex: true,
                isActive: true,
                createdAt: true,
              },
            });
          }

          await tx.exerciseDefinitionColorPoint.createMany({
            data: input.colorPoints.map((row) => ({
              tenantId: ctx.tenantId,
              exerciseDefinitionId: definition.id,
              colorOptionId: row.colorOptionId,
              points: row.points,
            })),
          });

          return {
            ...definition,
            startDate: supportsVisibilityColumns ? (definition.startDate ?? null) : null,
            isHidden: supportsVisibilityColumns ? Boolean(definition.isHidden) : false,
          };
        });
      } catch (error) {
        if (isIncorrectBinaryBindParameterError(error)) {
          throwFractionalPointsMigrationError();
        }
        throw error;
      }

      return created;
    }),

  updateExerciseDefinition: managerProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        type: z.enum(['class', 'homework', 'extra']).optional(),
        targetCount: z.number().int().min(1).max(100).optional(),
        startDate: z.string().nullable().optional(),
        orderIndex: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
        colorPoints: z.array(
          z.object({
            colorOptionId: z.string(),
            points: z.number().finite().min(0).max(10000),
          }),
        ).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.exerciseDefinition.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        select: {
          id: true,
          colorPoints: {
            select: {
              colorOptionId: true,
              points: true,
            },
          },
        },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mashq topilmadi' });
      }

      const { id, colorPoints, startDate, ...data } = input;
      const hasStartDateInput = startDate !== undefined;
      const updateDataWithoutStartDate = { ...data };
      const updateData = {
        ...data,
        ...(hasStartDateInput
          ? { startDate: startDate ? parseLocalDateInput(startDate, "Mashq boshlanish sanasi") : null }
          : {}),
      };
      const mutationSelect = (withVisibilityColumns: boolean) => ({
        id: true,
        tenantId: true,
        courseId: true,
        name: true,
        type: true,
        targetCount: true,
        orderIndex: true,
        isActive: true,
        ...(withVisibilityColumns ? { startDate: true, isHidden: true } : {}),
        createdAt: true,
      });
      const updateExerciseDefinitionMetadata = async (tx: any) => {
        try {
          return await tx.exerciseDefinition.update({
            where: { id },
            data: updateData,
            select: mutationSelect(true),
          });
        } catch (error) {
          if (!isMissingExerciseDefinitionVisibilityColumnError(error)) {
            throw error;
          }
          if (hasStartDateInput) {
            throwMissingExerciseStartDateMigrationError();
          }
          const updated = await tx.exerciseDefinition.update({
            where: { id },
            data: updateDataWithoutStartDate,
            select: mutationSelect(false),
          });
          return { ...updated, startDate: null, isHidden: false };
        }
      };

      if (!colorPoints) {
        return updateExerciseDefinitionMetadata(prisma);
      }

      const existingPointMap = new Map(existing.colorPoints.map((row) => [row.colorOptionId, row.points]));
      const colorPointsUnchanged =
        existing.colorPoints.length === colorPoints.length
        && colorPoints.every((row) => {
          const current = existingPointMap.get(row.colorOptionId);
          return current !== undefined && Math.abs(current - row.points) < 1e-9;
        });

      // Avoid unnecessary rewrite of mapping rows when only metadata (e.g. orderIndex) changes.
      if (colorPointsUnchanged) {
        return updateExerciseDefinitionMetadata(prisma);
      }

      const activeColorOptions = await prisma.exerciseColorOption.findMany({
        where: { tenantId: ctx.tenantId, isActive: true },
        select: { id: true },
      });

      if (activeColorOptions.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Avval rang sozlamalarini kiriting' });
      }

      const activeColorIds = new Set(activeColorOptions.map((row) => row.id));
      const providedColorIds = new Set<string>();
      for (const row of colorPoints) {
        if (!activeColorIds.has(row.colorOptionId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ranglar ro\'yxati noto\'g\'ri' });
        }
        if (providedColorIds.has(row.colorOptionId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bir xil rang ikki marta kiritildi' });
        }
        providedColorIds.add(row.colorOptionId);
      }

      if (providedColorIds.size !== activeColorIds.size) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Har bir faol rang uchun ball kiriting' });
      }

      try {
        return await prisma.$transaction(async (tx) => {
          const updatedDefinition = await updateExerciseDefinitionMetadata(tx);
          await tx.exerciseDefinitionColorPoint.deleteMany({
            where: { tenantId: ctx.tenantId, exerciseDefinitionId: id },
          });
          await tx.exerciseDefinitionColorPoint.createMany({
            data: colorPoints.map((row) => ({
              tenantId: ctx.tenantId,
              exerciseDefinitionId: id,
              colorOptionId: row.colorOptionId,
              points: row.points,
            })),
          });
          return updatedDefinition;
        });
      } catch (error) {
        if (isIncorrectBinaryBindParameterError(error)) {
          throwFractionalPointsMigrationError();
        }
        throw error;
      }
    }),

  setExerciseDefinitionHidden: adminProcedure
    .input(
      z.object({
        id: z.string(),
        isHidden: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.exerciseDefinition.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        select: { id: true, courseId: true },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mashq topilmadi' });
      }

      if (input.isHidden) {
        let activeRun: { id: string } | null = null;
        try {
          activeRun = await prisma.courseRun.findFirst({
            where: {
              tenantId: ctx.tenantId,
              courseId: existing.courseId,
              isHidden: false,
              endDate: { gte: new Date() },
            },
            select: { id: true },
          });
        } catch (error) {
          if (!isMissingCourseRunHiddenColumnError(error)) {
            throw error;
          }
          activeRun = await prisma.courseRun.findFirst({
            where: {
              tenantId: ctx.tenantId,
              courseId: existing.courseId,
              endDate: { gte: new Date() },
            },
            select: { id: true },
          });
        }
        if (activeRun) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Faol yoki kelajakdagi oqim bor kurs mashqini yashirib bo\'lmaydi',
          });
        }
      }

      return prisma.exerciseDefinition.update({
        where: { id: existing.id },
        data: { isHidden: input.isHidden },
        select: { id: true },
      }).catch((error) => {
        if (isMissingExerciseDefinitionVisibilityColumnError(error)) {
          throwMissingVisibilityMigrationError();
        }
        throw error;
      });
    }),

  listKurators: protectedProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: { tenantId: ctx.tenantId, roles: isAssignableKuratorWhere(), isActive: true },
      select: { id: true, name: true, username: true, email: true, phone: true, roles: true },
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
    });
  }),

  assignStudent: adminProcedure
    .input(
      z.object({
        kuratorUserId: z.string(),
        customerId: z.string(),
        courseRunId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [kurator, customer, courseRun] = await Promise.all([
        prisma.user.findFirst({
          where: {
            id: input.kuratorUserId,
            tenantId: ctx.tenantId,
            roles: isAssignableKuratorWhere(),
            isActive: true,
          },
          select: { id: true },
        }),
        prisma.customer.findFirst({
          where: { id: input.customerId, tenantId: ctx.tenantId },
          select: { id: true },
        }),
        prisma.courseRun
          .findFirst({
            where: { id: input.courseRunId, tenantId: ctx.tenantId },
            select: { id: true, courseId: true, kuratorUserId: true },
          })
          .catch((error) => {
            if (isMissingCourseRunsTableError(error)) {
              throwMissingCourseRunsMigrationError();
            }
            throw error;
          }),
      ]);

      if (!kurator) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurator topilmadi' });
      if (!customer) throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
      if (!courseRun) throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      if (courseRun.kuratorUserId !== input.kuratorUserId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Kurator oqim egasi bilan mos emas' });
      }
      const member = await prisma.courseRunMember.findFirst({
        where: {
          tenantId: ctx.tenantId,
          courseRunId: input.courseRunId,
          customerId: input.customerId,
        },
        select: { id: true },
      });
      if (!member) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "O'quvchi oqim a'zosi emas" });
      }

      const assignment = await prisma.$transaction(async (tx) => {
        await lockCourseRoster(tx, ctx.tenantId, courseRun.courseId);
        await tx.kuratorAssignment.updateMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: input.customerId,
            courseRunId: input.courseRunId,
            kuratorUserId: { not: input.kuratorUserId },
            isActive: true,
          },
          data: { isActive: false },
        });
        return tx.kuratorAssignment.upsert({
          where: {
            tenantId_kuratorUserId_customerId_courseRunId: {
              tenantId: ctx.tenantId,
              kuratorUserId: input.kuratorUserId,
              customerId: input.customerId,
              courseRunId: input.courseRunId,
            },
          },
          create: {
            tenantId: ctx.tenantId,
            kuratorUserId: input.kuratorUserId,
            customerId: input.customerId,
            courseRunId: input.courseRunId,
            isActive: true,
          },
          update: { isActive: true },
        });
      }, { isolationLevel: 'Serializable' });

      return assignment;
    }),

  unassignStudent: adminProcedure
    .input(
      z.object({
        kuratorUserId: z.string(),
        customerId: z.string(),
        courseRunId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await prisma.courseRun.findFirst({
        where: {
          id: input.courseRunId,
          tenantId: ctx.tenantId,
          kuratorUserId: input.kuratorUserId,
        },
        select: { id: true, courseId: true },
      });
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim yoki kurator topilmadi' });
      await prisma.$transaction(async (tx) => {
        await lockCourseRoster(tx, ctx.tenantId, run.courseId);
        await tx.courseRunMember.deleteMany({
          where: {
            tenantId: ctx.tenantId,
            courseRunId: input.courseRunId,
            customerId: input.customerId,
          },
        });
        await tx.kuratorAssignment.updateMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: input.customerId,
            courseRunId: input.courseRunId,
          },
          data: { isActive: false },
        });
      }, { isolationLevel: 'Serializable' });
      return { success: true };
    }),

  attachKuratorToRun: managerProcedure
    .input(
      z.object({
        courseRunId: z.string(),
        kuratorUserId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const courseRun = await prisma.courseRun
        .findFirst({
          where: { id: input.courseRunId, tenantId: ctx.tenantId },
          select: { id: true, courseId: true },
        })
        .catch((error) => {
          if (isMissingCourseRunsTableError(error)) {
            throwMissingCourseRunsMigrationError();
          }
          throw error;
        });
      if (!courseRun) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }

      const kurator = await prisma.user.findFirst({
        where: {
          id: input.kuratorUserId,
          tenantId: ctx.tenantId,
          roles: isAssignableKuratorWhere(),
          isActive: true,
        },
        select: { id: true },
      });
      if (!kurator) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurator topilmadi' });
      }

      const syncedCount = await prisma.$transaction(async (tx) => {
        await lockCourseRoster(tx, ctx.tenantId, courseRun.courseId);
        await tx.courseRun.update({
          where: { id: input.courseRunId },
          data: { kuratorUserId: input.kuratorUserId },
        });
        const members = await tx.courseRunMember.findMany({
          where: { tenantId: ctx.tenantId, courseRunId: input.courseRunId },
          select: { customerId: true },
        });
        await tx.kuratorAssignment.updateMany({
          where: { tenantId: ctx.tenantId, courseRunId: input.courseRunId, isActive: true },
          data: { isActive: false },
        });
        if (members.length > 0) {
          await tx.kuratorAssignment.createMany({
            data: members.map(({ customerId }) => ({
              tenantId: ctx.tenantId,
              courseRunId: input.courseRunId,
              customerId,
              kuratorUserId: input.kuratorUserId,
              isActive: true,
            })),
            skipDuplicates: true,
          });
          await tx.kuratorAssignment.updateMany({
            where: {
              tenantId: ctx.tenantId,
              courseRunId: input.courseRunId,
              kuratorUserId: input.kuratorUserId,
              customerId: { in: members.map(({ customerId }) => customerId) },
            },
            data: { isActive: true },
          });
        }
        return members.length;
      }, { isolationLevel: 'Serializable' });

      return {
        runId: input.courseRunId,
        kuratorUserId: input.kuratorUserId,
        syncedCount,
      };
    }),

  /** Returns the explicit roster (customer IDs) for a run. */
  listCourseRunMembers: managerProcedure
    .input(z.object({ courseRunId: z.string() }))
    .query(async ({ ctx, input }) => {
      const courseRun = await prisma.courseRun.findFirst({
        where: { id: input.courseRunId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!courseRun) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }
      const rows = await prisma.courseRunMember.findMany({
        where: { tenantId: ctx.tenantId, courseRunId: input.courseRunId },
        select: { customerId: true },
      });
      return rows.map((row) => row.customerId);
    }),

  /**
   * Returns customers eligible to be added to a course-run roster: anyone with an active
   * `new_sale` income on the course (optionally filtered by tariff).
   * Used by the CourseRunsTab create/edit form's checkbox picker.
   */
  listEnrollableStudents: managerProcedure
    .input(
      z.object({
        courseId: z.string(),
        tariffId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        tenantId: ctx.tenantId,
        courseId: input.courseId,
        type: 'new_sale' as const,
        lifecycleStatus: 'active' as const,
        ...(input.tariffId ? { tariffId: input.tariffId } : {}),
      };

      const runQuery = async (includeGender: boolean) =>
        prisma.income.findMany({
          where,
          select: {
            customerId: true,
            customer: {
              select: {
                id: true,
                name: true,
                customerNumber: true,
                ...(includeGender ? { gender: true } : {}),
              },
            },
            tariff: { select: { id: true, name: true } },
            entryDate: true,
          },
          orderBy: [{ customerId: 'asc' }, { entryDate: 'desc' }],
          distinct: ['customerId'],
        });

      let incomes: Array<{
        customerId: string;
        customer: {
          id: string;
          name: string;
          customerNumber: string;
          gender?: string | null;
        } | null;
        tariff: { id: string; name: string } | null;
      }> = [];

      let includeGender = true;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          incomes = await runQuery(includeGender);
          break;
        } catch (error) {
          const missingGender = includeGender && isMissingCustomerGenderColumnError(error);
          if (!missingGender) {
            throw error;
          }
          if (missingGender) includeGender = false;
        }
      }

      return incomes
        .filter((income) => Boolean(income.customerId && income.customer))
        .map((income) => ({
          id: income.customer!.id,
          name: income.customer!.name,
          customerNumber: income.customer?.customerNumber || null,
          gender: income.customer?.gender ?? null,
          tariffId: income.tariff?.id ?? null,
          tariffName: income.tariff?.name ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'uz'));
    }),

  detachKuratorFromRun: managerProcedure
    .input(z.object({ courseRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const courseRun = await prisma.courseRun
        .findFirst({
          where: { id: input.courseRunId, tenantId: ctx.tenantId },
          select: { id: true, courseId: true },
        })
        .catch((error) => {
          if (isMissingCourseRunsTableError(error)) {
            throwMissingCourseRunsMigrationError();
          }
          throw error;
        });
      if (!courseRun) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }

      await prisma.$transaction(async (tx) => {
        await lockCourseRoster(tx, ctx.tenantId, courseRun.courseId);
        await tx.courseRun.update({
          where: { id: input.courseRunId },
          data: { kuratorUserId: null },
        });
        await tx.kuratorAssignment.updateMany({
          where: {
            tenantId: ctx.tenantId,
            courseRunId: input.courseRunId,
            isActive: true,
          },
          data: { isActive: false },
        });
      }, { isolationLevel: 'Serializable' });

      return { success: true };
    }),

  listCourses: protectedProcedure.query(async ({ ctx }) => {
    return prisma.course.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, category: true, startDate: true, endDate: true },
      orderBy: { name: 'asc' },
    });
  }),

  listCoursesWithStatus: adminProcedure.query(async ({ ctx }) => {
    return prisma.course.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        id: true,
        name: true,
        category: true,
        startDate: true,
        isActive: true,
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }),

  setCourseActive: adminProcedure
    .input(
      z.object({
        courseId: z.string(),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi' });
      }

      return prisma.course.update({
        where: { id: input.courseId },
        data: { isActive: input.isActive },
        select: { id: true, isActive: true },
      });
    }),

  listTariffsByCourse: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
        where: {
          id: input.courseId,
          tenantId: ctx.tenantId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi' });
      }

      return prisma.tariff.findMany({
        where: {
          tenantId: ctx.tenantId,
          courseId: input.courseId,
          isActive: true,
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    }),

  listTariffsByCourseRun: protectedProcedure
    .input(z.object({ courseRunId: z.string() }))
    .query(async ({ ctx, input }) => {
      const courseRun = await prisma.courseRun
        .findFirst({
          where: { id: input.courseRunId, tenantId: ctx.tenantId },
          select: { courseId: true },
        })
        .catch((error) => {
          if (isMissingCourseRunsTableError(error)) {
            throwMissingCourseRunsMigrationError();
          }
          throw error;
        });

      if (!courseRun) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }

      return prisma.tariff.findMany({
        where: {
          tenantId: ctx.tenantId,
          courseId: courseRun.courseId,
          isActive: true,
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    }),

  assignStudentsBulk: managerProcedure
    .input(
      z.object({
        kuratorUserId: z.string(),
        courseRunId: z.string(),
        customerIds: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const uniqueCustomerIds = Array.from(new Set(input.customerIds));
      const [kurator, courseRun, customers] = await Promise.all([
        prisma.user.findFirst({
          where: {
            id: input.kuratorUserId,
            tenantId: ctx.tenantId,
            roles: isAssignableKuratorWhere(),
            isActive: true,
          },
          select: { id: true },
        }),
        prisma.courseRun
          .findFirst({
            where: { id: input.courseRunId, tenantId: ctx.tenantId },
            select: { id: true, courseId: true, kuratorUserId: true },
          })
          .catch((error) => {
            if (isMissingCourseRunsTableError(error)) {
              throwMissingCourseRunsMigrationError();
            }
            throw error;
          }),
        prisma.customer.findMany({
          where: { tenantId: ctx.tenantId, id: { in: uniqueCustomerIds } },
          select: { id: true },
        }),
      ]);

      if (!kurator) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurator topilmadi' });
      }
      if (!courseRun) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }
      if (courseRun.kuratorUserId !== input.kuratorUserId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Kurator oqim egasi bilan mos emas' });
      }

      const validCustomerIds = new Set(customers.map((c) => c.id));
      const missing = uniqueCustomerIds.filter((id) => !validCustomerIds.has(id));
      if (missing.length > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Ba'zi o'quvchilar topilmadi" });
      }
      const memberRows = await prisma.courseRunMember.findMany({
        where: {
          tenantId: ctx.tenantId,
          courseRunId: input.courseRunId,
          customerId: { in: uniqueCustomerIds },
        },
        select: { customerId: true },
      });
      if (memberRows.length !== uniqueCustomerIds.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Ba'zi o'quvchilar oqim a'zosi emas" });
      }

      await prisma.$transaction(async (tx) => {
        await lockCourseRoster(tx, ctx.tenantId, courseRun.courseId);
        await tx.kuratorAssignment.updateMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: { in: uniqueCustomerIds },
            courseRunId: input.courseRunId,
            kuratorUserId: { not: input.kuratorUserId },
            isActive: true,
          },
          data: { isActive: false },
        });
        for (const customerId of uniqueCustomerIds) {
          await tx.kuratorAssignment.upsert({
            where: {
              tenantId_kuratorUserId_customerId_courseRunId: {
                tenantId: ctx.tenantId,
                kuratorUserId: input.kuratorUserId,
                customerId,
                courseRunId: input.courseRunId,
              },
            },
            create: {
              tenantId: ctx.tenantId,
              kuratorUserId: input.kuratorUserId,
              customerId,
              courseRunId: input.courseRunId,
              isActive: true,
            },
            update: { isActive: true },
          });
        }
      }, { isolationLevel: 'Serializable' });

      return { assignedCount: uniqueCustomerIds.length };
    }),

  telegramReportStatus: managerProcedure.query(async ({ ctx }) => {
    return getTelegramReportStatus(ctx.tenantId);
  }),

  createTelegramLinkToken: protectedProcedure.mutation(async ({ ctx }) => {
    return createTelegramLinkToken(ctx.tenantId, ctx.user.userId);
  }),

  telegramSelfStatus: protectedProcedure.query(async ({ ctx }) => {
    return getTelegramSelfStatus(ctx.tenantId, ctx.user.userId);
  }),

  sendTelegramTestReport: managerProcedure
    .input(
      z.object({
        preset: z.enum(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return sendTelegramTestReport(ctx.tenantId, ctx.user.userId, input.preset);
    }),

  deleteTelegramReceiver: managerProcedure
    .input(
      z.object({
        receiverId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return deleteTelegramReceiver(ctx.tenantId, input.receiverId);
    }),

  generateReportShareToken: adminProcedure
    .input(
      z.object({
        courseId: z.string(),
        courseRunId: z.string().optional(),
        tariffId: z.string().optional(),
        kuratorUserId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const jwtSecret = process.env.JWT_SECRET?.trim();
      if (!jwtSecret) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'JWT sozlanmagan' });
      }

      const [course, courseRun, tariff, kurator] = await Promise.all([
        prisma.course.findFirst({
          where: { id: input.courseId, tenantId: ctx.tenantId, isActive: true },
          select: { id: true },
        }),
        input.courseRunId
          ? prisma.courseRun.findFirst({
              where: { id: input.courseRunId, tenantId: ctx.tenantId, courseId: input.courseId },
              select: { id: true, kuratorUserId: true },
            })
          : Promise.resolve(null),
        input.tariffId
          ? prisma.tariff.findFirst({
              where: { id: input.tariffId, tenantId: ctx.tenantId, courseId: input.courseId, isActive: true },
              select: { id: true },
            })
          : Promise.resolve(null),
        input.kuratorUserId
          ? prisma.user.findFirst({
              where: { id: input.kuratorUserId, tenantId: ctx.tenantId, isActive: true },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      if (!course || (input.courseRunId && !courseRun) || (input.tariffId && !tariff) || (input.kuratorUserId && !kurator)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Hisobot filtrlari yaroqsiz" });
      }
      if (input.courseRunId && input.kuratorUserId && courseRun?.kuratorUserId !== input.kuratorUserId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Kurator oqim egasi bilan mos emas' });
      }

      const payload = {
        type: 'report_share',
        tenantId: ctx.tenantId,
        courseId: input.courseId,
        courseRunId: input.courseRunId || null,
        tariffId: input.tariffId || null,
        kuratorUserId: input.kuratorUserId || null,
        generatedBy: ctx.user.userId,
      };

      const token = jwt.sign(payload, jwtSecret, { expiresIn: '30d' });
      return { token };
    }),

  /** Removes roster members who no longer have an active course enrollment. */
  syncCourseRunMembers: adminProcedure
    .input(
      z.object({
        courseRunId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await prisma.courseRun.findFirst({
        where: { id: input.courseRunId, tenantId: ctx.tenantId },
        select: { id: true, courseId: true, endDate: true },
      });
      if (!run) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs oqimi topilmadi' });
      }

      if (startOfDayLocal(run.endDate) < startOfDayLocal(new Date())) {
        const historicalRosterCount = await prisma.courseRunMember.count({
          where: { tenantId: ctx.tenantId, courseRunId: run.id },
        });
        return {
          courseRunId: run.id,
          courseId: run.courseId,
          added: 0,
          removed: 0,
          totalActive: 0,
          totalRoster: historicalRosterCount,
        };
      }

      // Active income customers for this course
      const activeIncomeCustomers = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          courseId: run.courseId,
          type: 'new_sale',
          lifecycleStatus: 'active',
        },
        select: { customerId: true },
        distinct: ['customerId'],
      });
      const activeSet = new Set(activeIncomeCustomers.map((r) => r.customerId));

      // Current roster
      const currentRoster = await prisma.courseRunMember.findMany({
        where: { tenantId: ctx.tenantId, courseRunId: run.id },
        select: { customerId: true },
      });
      const rosterSet = new Set(currentRoster.map((r) => r.customerId));

      // Customers to remove: in roster but no active income
      const toRemove = Array.from(rosterSet).filter((id) => !activeSet.has(id));

      if (toRemove.length > 0) {
        await prisma.courseRunMember.deleteMany({
          where: {
            tenantId: ctx.tenantId,
            courseRunId: run.id,
            customerId: { in: toRemove },
          },
        });
      }

      return {
        courseRunId: run.id,
        courseId: run.courseId,
        added: 0,
        removed: toRemove.length,
        totalActive: activeSet.size,
        totalRoster: rosterSet.size - toRemove.length,
      };
    }),
});

