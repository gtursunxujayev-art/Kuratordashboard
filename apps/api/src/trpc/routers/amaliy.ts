import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { getCustomersScopedToKurator, kuratorCanAccessCustomer } from '../utils/kuratorScope';

const ACTIVE_ENROLLMENT_FILTER = {
  type: 'new_sale' as const,
  lifecycleStatus: 'active' as const,
};

function isMissingCustomerTelegramColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('customers.telegramusername') && message.includes('does not exist');
  }
  return message.includes('customers.telegramusername');
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

function isPointsTypeMigrationMismatchError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('22p03') &&
    message.includes('incorrect binary data format') &&
    message.includes('bind parameter')
  );
}

function isTransactionClosedError(error: unknown): boolean {
  const code = String((error as any)?.code || '').toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  if (code === 'P2028') return true;
  return (
    message.includes('transaction not found') ||
    message.includes('transaction already closed') ||
    (message.includes('transaction api error') && message.includes('transaction id'))
  );
}

function isClassDay(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function parseDateInput(dateInput: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = dateOnly.exec(dateInput.trim());
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const fallback = new Date(dateInput);
  if (Number.isNaN(fallback.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sana noto\'g\'ri formatda' });
  }
  return fallback;
}

function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDaysLocal(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isEligibleExerciseDate(type: string, date: Date): boolean {
  const day = date.getDay();
  if (type === 'homework') {
    return day >= 1 && day <= 5;
  }
  if (type === 'class') {
    return day === 0 || day === 6;
  }
  if (type === 'extra') {
    return day >= 1 && day <= 5;
  }
  return true;
}

function buildExerciseSlotDates(params: {
  startDate: Date;
  endDate: Date;
  type: string;
  targetCount: number;
}) {
  const start = startOfDayLocal(params.startDate);
  const end = startOfDayLocal(params.endDate);
  const allEligible: Date[] = [];
  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor = addDaysLocal(cursor, 1)) {
    if (isEligibleExerciseDate(params.type, cursor)) {
      allEligible.push(new Date(cursor));
    }
  }
  return {
    slotDates: allEligible.slice(0, Math.max(0, params.targetCount)),
    hasInsufficientEligibleDates: allEligible.length < params.targetCount,
  };
}

function isPremiumTariffName(name: string | null | undefined): boolean {
  const value = (name || '').toLowerCase();
  return value.includes('premium') || value.includes('vip');
}

async function resolveCourseRunCustomerIds(params: {
  tenantId: string;
  courseRunId: string;
  courseId: string;
}): Promise<string[]> {
  const { tenantId, courseRunId, courseId } = params;

  try {
    const explicitMembers = await prisma.courseRunMember.findMany({
      where: { tenantId, courseRunId },
      select: { customerId: true },
    });
    if (explicitMembers.length > 0) {
      return explicitMembers.map((row) => row.customerId);
    }
  } catch (error) {
    if (!isMissingCourseRunMembersTableError(error)) {
      throw error;
    }
  }

  const enrolled = await prisma.income.findMany({
    where: {
      tenantId,
      courseId,
      ...ACTIVE_ENROLLMENT_FILTER,
    },
    select: { customerId: true },
    distinct: ['customerId'],
  });

  return enrolled.map((row) => row.customerId).filter((id): id is string => Boolean(id));
}

async function getCourseRunForDate(tenantId: string, date: Date, courseRunId?: string) {
  const dayStart = startOfDayLocal(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  try {
    return await prisma.courseRun.findFirst({
      where: {
        tenantId,
        ...(courseRunId ? { id: courseRunId } : {}),
        ...(courseRunId
          ? {}
          : {
              startDate: { lte: dayEnd },
              endDate: { gte: dayStart },
            }),
      },
    });
  } catch (error) {
    if (!isMissingCourseRunsTableError(error)) {
      throw error;
    }
    return null;
  }
}

async function getStudentPremiumEligibility(tenantId: string, customerId: string): Promise<boolean> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: {
      id: true,
      incomes: {
        where: ACTIVE_ENROLLMENT_FILTER,
        select: { tariff: { select: { name: true } } },
        orderBy: { entryDate: 'desc' },
        take: 1,
      },
    },
  });

  if (!customer) {
    throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
  }

  return isPremiumTariffName(customer.incomes[0]?.tariff?.name);
}

export const amaliyRouter = router({
  studentList: protectedProcedure
    .input(z.object({ courseRunId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      let customerIds: string[] | undefined;

      if (isKurator) {
        customerIds = await getCustomersScopedToKurator({
          tenantId,
          kuratorUserId: user.userId,
          courseRunId: input.courseRunId,
        });
      } else if (input.courseRunId) {
        const run = await prisma.courseRun
          .findFirst({
            where: { tenantId, id: input.courseRunId },
            select: { id: true, courseId: true },
          })
          .catch((error) => {
            if (isMissingCourseRunsTableError(error)) {
              return null;
            }
            throw error;
          });

        if (!run) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
        }

        customerIds = await resolveCourseRunCustomerIds({
          tenantId,
          courseRunId: run.id,
          courseId: run.courseId,
        });
      }

      try {
        return await prisma.customer.findMany({
          where: {
            tenantId,
            ...(customerIds ? { id: { in: customerIds } } : {}),
          },
          select: { id: true, customerNumber: true, name: true, telegramUsername: true },
          orderBy: { name: 'asc' },
        }).then((rows) =>
          rows.map((row) => ({
            ...row,
            telegramUsername: row.telegramUsername ?? null,
          })),
        );
      } catch (error) {
        if (!isMissingCustomerTelegramColumnError(error)) {
          throw error;
        }

        return prisma.customer.findMany({
          where: {
            tenantId,
            ...(customerIds ? { id: { in: customerIds } } : {}),
          },
          select: {
            id: true,
            customerNumber: true,
            name: true,
          },
          orderBy: { name: 'asc' },
        }).then((rows) =>
          rows.map((row) => ({
            ...row,
            telegramUsername: null,
          })),
        );
      }
    }),

  listPracticeStudents: protectedProcedure
    .input(
      z.object({
        exerciseDefinitionId: z.string(),
        date: z.string(),
        courseRunId: z.string().optional(),
        includeCompleted: z.boolean().optional().default(false),
        search: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const kuratorOnly =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');
      const isManagerOrAdmin =
        user.roles.includes('Admin') ||
        user.roles.includes('Manager');

      if (input.includeCompleted && !isManagerOrAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Faqat menejer yoki adminlar uchun' });
      }
      if (input.includeCompleted && !input.courseRunId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Hammasi uchun oqim tanlang' });
      }

      const exercise = await prisma.exerciseDefinition.findFirst({
        where: {
          id: input.exerciseDefinitionId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          courseId: true,
          type: true,
          targetCount: true,
        },
      });

      if (!exercise) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mashq topilmadi' });
      }

      let selectedRunCourseId: string | null = null;
      let selectedRunDateRange: { startDate: Date; endDate: Date } | null = null;
      if (input.courseRunId) {
        const selectedRun = await prisma.courseRun
          .findFirst({
            where: {
              id: input.courseRunId,
              tenantId,
            },
            select: { id: true, courseId: true, startDate: true, endDate: true },
          })
          .catch((error) => {
            if (isMissingCourseRunsTableError(error)) {
              return null;
            }
            throw error;
          });

        if (!selectedRun) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
        }

        selectedRunCourseId = selectedRun.courseId;
        selectedRunDateRange = {
          startDate: selectedRun.startDate,
          endDate: selectedRun.endDate,
        };
      }

      if (selectedRunCourseId && selectedRunCourseId !== exercise.courseId) {
        return [];
      }

      let assignedCustomerIds: string[] = [];
      if (input.courseRunId) {
        assignedCustomerIds = await resolveCourseRunCustomerIds({
          tenantId,
          courseRunId: input.courseRunId,
          courseId: exercise.courseId,
        });

        if (kuratorOnly) {
          const kuratorScopedIds = await getCustomersScopedToKurator({
            tenantId,
            kuratorUserId: user.userId,
            courseRunId: input.courseRunId,
          });
          const scopedSet = new Set(kuratorScopedIds);
          assignedCustomerIds = assignedCustomerIds.filter((id) => scopedSet.has(id));
        }
      } else {
        const assignments = await prisma.kuratorAssignment.findMany({
          where: {
            tenantId,
            courseRun: { courseId: exercise.courseId },
            isActive: true,
            ...(kuratorOnly ? { kuratorUserId: user.userId } : {}),
          },
          select: { customerId: true },
        });
        assignedCustomerIds = Array.from(new Set(assignments.map((row) => row.customerId)));
      }

      if (assignedCustomerIds.length === 0) {
        return [];
      }

      const date = parseDateInput(input.date);
      if (!input.includeCompleted && !isEligibleExerciseDate(exercise.type, date)) {
        return [];
      }
      const dayStart = startOfDayLocal(date);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const completedRows = await prisma.studentExerciseLog.findMany({
        where: {
          tenantId,
          exerciseDefinitionId: exercise.id,
          customerId: { in: assignedCustomerIds },
          completedAt: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true, customerId: true },
        orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      });

      const completedByCustomer = new Map<string, { completedLogId: string }>();
      for (const row of completedRows) {
        if (!completedByCustomer.has(row.customerId)) {
          completedByCustomer.set(row.customerId, { completedLogId: row.id });
        }
      }
      const completedSet = new Set(completedByCustomer.keys());
      const scopedCustomerIds = input.includeCompleted
        ? assignedCustomerIds
        : assignedCustomerIds.filter((customerId) => !completedSet.has(customerId));

      if (scopedCustomerIds.length === 0) {
        return [];
      }

      const search = input.search?.trim().toLowerCase();
      const slotInfo = input.includeCompleted && selectedRunDateRange
        ? buildExerciseSlotDates({
            startDate: selectedRunDateRange.startDate,
            endDate: selectedRunDateRange.endDate,
            type: exercise.type,
            targetCount: exercise.targetCount,
          })
        : { slotDates: [] as Date[], hasInsufficientEligibleDates: false };
      const slotDateObjects = slotInfo.slotDates;
      const slotDateKeys = slotDateObjects.map((date) => toDateKeyLocal(date));

      const slotLogsByCustomerDate = new Map<string, {
        colorOptionId: string | null;
        colorHex: string | null;
        points: number | null;
      }>();

      if (input.includeCompleted && selectedRunDateRange && scopedCustomerIds.length > 0) {
        const runStart = startOfDayLocal(selectedRunDateRange.startDate);
        const runEndExclusive = addDaysLocal(startOfDayLocal(selectedRunDateRange.endDate), 1);
        const slotLogs = await prisma.studentExerciseLog.findMany({
          where: {
            tenantId,
            exerciseDefinitionId: exercise.id,
            customerId: { in: scopedCustomerIds },
            completedAt: { gte: runStart, lt: runEndExclusive },
          },
          select: {
            customerId: true,
            completedAt: true,
            colorOptionId: true,
            colorHex: true,
            points: true,
            createdAt: true,
          },
          orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
        });

        const slotDateKeySet = new Set(slotDateKeys);
        for (const log of slotLogs) {
          const dateKey = toDateKeyLocal(log.completedAt);
          if (!slotDateKeySet.has(dateKey)) continue;
          const key = `${log.customerId}:${dateKey}`;
          if (slotLogsByCustomerDate.has(key)) continue;
          slotLogsByCustomerDate.set(key, {
            colorOptionId: log.colorOptionId,
            colorHex: log.colorHex,
            points: log.points ?? null,
          });
        }
      }

      try {
        const rows = await prisma.customer.findMany({
          where: {
            tenantId,
            id: { in: scopedCustomerIds },
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { customerNumber: { contains: search, mode: 'insensitive' } },
                    { telegramUsername: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            name: true,
            customerNumber: true,
            telegramUsername: true,
          },
          orderBy: { name: 'asc' },
        });

        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          customerNumber: row.customerNumber,
          telegramUsername: row.telegramUsername ?? null,
          completedForDate: completedSet.has(row.id),
          completedLogId: completedByCustomer.get(row.id)?.completedLogId ?? null,
          slots: input.includeCompleted
            ? slotDateKeys.map((dateKey) => {
                const slot = slotLogsByCustomerDate.get(`${row.id}:${dateKey}`);
                return {
                  date: dateKey,
                  selectedColorOptionId: slot?.colorOptionId ?? null,
                  selectedColorHex: slot?.colorHex ?? null,
                  selectedPoints: slot?.points ?? null,
                  isSaved: Boolean(slot?.colorOptionId),
                };
              })
            : [],
          hasInsufficientEligibleDates: slotInfo.hasInsufficientEligibleDates,
        }));
      } catch (error) {
        if (!isMissingCustomerTelegramColumnError(error)) {
          throw error;
        }

        const rows = await prisma.customer.findMany({
          where: {
            tenantId,
            id: { in: scopedCustomerIds },
            ...(search
              ? {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { customerNumber: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            name: true,
            customerNumber: true,
          },
          orderBy: { name: 'asc' },
        });

        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          customerNumber: row.customerNumber,
          telegramUsername: null,
          completedForDate: completedSet.has(row.id),
          completedLogId: completedByCustomer.get(row.id)?.completedLogId ?? null,
          slots: input.includeCompleted
            ? slotDateKeys.map((dateKey) => {
                const slot = slotLogsByCustomerDate.get(`${row.id}:${dateKey}`);
                return {
                  date: dateKey,
                  selectedColorOptionId: slot?.colorOptionId ?? null,
                  selectedColorHex: slot?.colorHex ?? null,
                  selectedPoints: slot?.points ?? null,
                  isSaved: Boolean(slot?.colorOptionId),
                };
              })
            : [],
          hasInsufficientEligibleDates: slotInfo.hasInsufficientEligibleDates,
        }));
      }
    }),

  getStudentExercises: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        date: z.string(),
        mode: z.enum(['day', 'all']).default('day'),
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');
      const isManagerOrAdmin =
        user.roles.includes('Admin') ||
        user.roles.includes('Manager');

      if (input.mode === 'all' && !isManagerOrAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Faqat menejer yoki adminlar uchun' });
      }
      if (input.mode === 'all' && !input.courseRunId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Hammasi uchun oqim tanlang' });
      }

      if (isKurator) {
        const allowed = await kuratorCanAccessCustomer({
          tenantId,
          kuratorUserId: user.userId,
          customerId: input.customerId,
        });
        if (!allowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      const date = parseDateInput(input.date);
      const classDay = isClassDay(date);
      const courseRun = await getCourseRunForDate(tenantId, date, input.courseRunId);

      if (!courseRun) {
        return {
          mode: input.mode,
          isClassDay: classDay,
          exercises: [],
          courseRunId: null,
          dateInfo: { date: input.date, dayOfWeek: date.getDay() },
          attendanceSummary: {
            base: { attended: 0, total: 0 },
            premiumExtra: { attended: 0, total: 0 },
            isPremiumEligible: false,
          },
        };
      }

      const premiumEligible = await getStudentPremiumEligibility(tenantId, input.customerId);
      const dayStart = startOfDayLocal(date);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const whereDefinitions: Record<string, unknown> = {
        tenantId,
        courseId: courseRun.courseId,
        isActive: true,
      };
      if (input.mode === 'day') {
        whereDefinitions.type = classDay ? 'class' : { in: ['homework', 'extra'] };
      }

      const definitions = await prisma.exerciseDefinition.findMany({
        where: whereDefinitions,
        include: {
          colorPoints: {
            where: { colorOption: { isActive: true } },
            include: {
              colorOption: {
                select: {
                  id: true,
                  label: true,
                  colorHex: true,
                  orderIndex: true,
                },
              },
            },
          },
        },
        orderBy: [{ type: 'asc' }, { orderIndex: 'asc' }, { createdAt: 'asc' }],
      });

      const definitionIds = definitions.map((d) => d.id);
      const runStart = startOfDayLocal(courseRun.startDate);
      const runEndExclusive = addDaysLocal(startOfDayLocal(courseRun.endDate), 1);
      const [todayLogs, totalLogs, attendanceTotals, attendanceAttended, runLogs] = await Promise.all([
        definitionIds.length > 0
          ? prisma.studentExerciseLog.findMany({
              where: {
                tenantId,
                customerId: input.customerId,
                exerciseDefinitionId: { in: definitionIds },
                completedAt: { gte: dayStart, lt: dayEnd },
              },
              select: { exerciseDefinitionId: true },
            })
          : Promise.resolve([]),
        definitionIds.length > 0
          ? prisma.studentExerciseLog.groupBy({
              by: ['exerciseDefinitionId'],
              where: {
                tenantId,
                customerId: input.customerId,
                exerciseDefinitionId: { in: definitionIds },
              },
              _count: { id: true },
            })
          : Promise.resolve([]),
        prisma.classAttendance.groupBy({
          by: ['lessonType'],
          where: {
            tenantId,
            customerId: input.customerId,
            courseRunId: courseRun.id,
          },
          _count: { id: true },
        }),
        prisma.classAttendance.groupBy({
          by: ['lessonType'],
          where: {
            tenantId,
            customerId: input.customerId,
            courseRunId: courseRun.id,
            attended: true,
          },
          _count: { id: true },
        }),
        input.mode === 'all' && definitionIds.length > 0
          ? prisma.studentExerciseLog.findMany({
              where: {
                tenantId,
                customerId: input.customerId,
                exerciseDefinitionId: { in: definitionIds },
                completedAt: { gte: runStart, lt: runEndExclusive },
              },
              select: {
                exerciseDefinitionId: true,
                completedAt: true,
                colorOptionId: true,
                colorHex: true,
                points: true,
                createdAt: true,
              },
              orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
            })
          : Promise.resolve([]),
      ]);

      const doneTodayByDef = new Map<string, number>();
      for (const row of todayLogs) {
        doneTodayByDef.set(row.exerciseDefinitionId, (doneTodayByDef.get(row.exerciseDefinitionId) ?? 0) + 1);
      }

      const doneTotalByDef = new Map<string, number>(
        totalLogs.map((row) => [row.exerciseDefinitionId, row._count.id]),
      );

      const attendanceTotalByType = new Map<string, number>(
        attendanceTotals.map((row) => [row.lessonType, row._count.id]),
      );
      const attendanceAttendedByType = new Map<string, number>(
        attendanceAttended.map((row) => [row.lessonType, row._count.id]),
      );
      const slotLogsByExerciseDate = new Map<string, {
        colorOptionId: string | null;
        colorHex: string | null;
        points: number | null;
      }>();
      if (input.mode === 'all') {
        for (const log of runLogs) {
          const dateKey = toDateKeyLocal(log.completedAt);
          const key = `${log.exerciseDefinitionId}:${dateKey}`;
          if (slotLogsByExerciseDate.has(key)) continue;
          slotLogsByExerciseDate.set(key, {
            colorOptionId: log.colorOptionId,
            colorHex: log.colorHex,
            points: log.points ?? null,
          });
        }
      }

      return {
        mode: input.mode,
        isClassDay: classDay,
        exerciseType: input.mode === 'day' ? (classDay ? 'class' : 'homework') : 'all',
        courseRunId: courseRun.id,
        dateInfo: { date: input.date, dayOfWeek: date.getDay() },
        exercises: definitions.map((def) => ({
          ...(input.mode === 'all'
            ? (() => {
                const slotInfo = buildExerciseSlotDates({
                  startDate: courseRun.startDate,
                  endDate: courseRun.endDate,
                  type: def.type,
                  targetCount: def.targetCount,
                });
                const slots = slotInfo.slotDates.map((slotDate) => {
                  const dateKey = toDateKeyLocal(slotDate);
                  const slot = slotLogsByExerciseDate.get(`${def.id}:${dateKey}`);
                  return {
                    date: dateKey,
                    selectedColorOptionId: slot?.colorOptionId ?? null,
                    selectedColorHex: slot?.colorHex ?? null,
                    selectedPoints: slot?.points ?? null,
                    isSaved: Boolean(slot?.colorOptionId),
                  };
                });
                return {
                  slots,
                  hasInsufficientEligibleDates: slotInfo.hasInsufficientEligibleDates,
                };
              })()
            : { slots: [], hasInsufficientEligibleDates: false }),
          id: def.id,
          name: def.name,
          type: def.type,
          targetCount: def.targetCount,
          doneToday: doneTodayByDef.get(def.id) ?? 0,
          doneTotal: doneTotalByDef.get(def.id) ?? 0,
          colorPoints: def.colorPoints
            .sort((left, right) => left.colorOption.orderIndex - right.colorOption.orderIndex)
            .map((row) => ({
              colorOptionId: row.colorOptionId,
              label: row.colorOption.label,
              colorHex: row.colorOption.colorHex,
              points: row.points,
            })),
        })),
        attendanceSummary: {
          base: {
            attended: attendanceAttendedByType.get('base') ?? 0,
            total: courseRun.baseLessons,
          },
          premiumExtra: {
            attended: attendanceAttendedByType.get('premium_extra') ?? 0,
            total: premiumEligible ? courseRun.premiumExtraLessons : 0,
          },
          isPremiumEligible: premiumEligible,
          recordedRows: {
            base: attendanceTotalByType.get('base') ?? 0,
            premiumExtra: attendanceTotalByType.get('premium_extra') ?? 0,
          },
        },
      };
    }),

  logExercise: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        exerciseDefinitionId: z.string(),
        colorOptionId: z.string(),
        completedAt: z.string(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      const definition = await prisma.exerciseDefinition.findFirst({
        where: { id: input.exerciseDefinitionId, tenantId },
        select: { id: true, type: true, targetCount: true },
      });
      if (!definition) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mashq topilmadi' });
      }

      const colorOption = await prisma.exerciseColorOption.findFirst({
        where: {
          id: input.colorOptionId,
          tenantId,
          isActive: true,
        },
        select: { id: true, colorHex: true, points: true },
      });
      if (!colorOption) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rang sozlamasi topilmadi' });
      }

      const definitionColorPoint = await prisma.exerciseDefinitionColorPoint.findFirst({
        where: {
          tenantId,
          exerciseDefinitionId: definition.id,
          colorOptionId: colorOption.id,
        },
        select: { points: true },
      });

      if (!definitionColorPoint) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ushbu mashq uchun rang balli sozlanmagan' });
      }

      if (isKurator) {
        const allowed = await kuratorCanAccessCustomer({
          tenantId,
          kuratorUserId: user.userId,
          customerId: input.customerId,
        });
        if (!allowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      const completedAt = parseDateInput(input.completedAt);
      const dayStart = startOfDayLocal(completedAt);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      if (!isEligibleExerciseDate(definition.type, dayStart)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Tanlangan sana ushbu mashq turi uchun mos emas",
        });
      }

      try {
        return await prisma.$transaction(async (tx) => {
          const existingLogForDay = await tx.studentExerciseLog.findFirst({
            where: {
              tenantId,
              customerId: input.customerId,
              exerciseDefinitionId: definition.id,
              completedAt: { gte: dayStart, lt: dayEnd },
            },
            select: { id: true },
            orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
          });

          if (existingLogForDay) {
            return tx.studentExerciseLog.update({
              where: { id: existingLogForDay.id },
              data: {
                colorOptionId: colorOption.id,
                colorHex: colorOption.colorHex,
                points: definitionColorPoint.points,
                completedAt: dayStart,
                loggedByUserId: user.userId,
                note: input.note,
              },
            });
          }

          const completedCount = await tx.studentExerciseLog.count({
            where: {
              tenantId,
              customerId: input.customerId,
              exerciseDefinitionId: definition.id,
            },
          });

          if (completedCount >= definition.targetCount) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Bu mashq uchun maksimal ${definition.targetCount} marta bajarish mumkin`,
            });
          }

          return tx.studentExerciseLog.create({
            data: {
              tenantId,
              customerId: input.customerId,
              exerciseDefinitionId: input.exerciseDefinitionId,
              colorOptionId: colorOption.id,
              colorHex: colorOption.colorHex,
              points: definitionColorPoint.points,
              completedAt: dayStart,
              loggedByUserId: user.userId,
              note: input.note,
            },
          });
        }, {
          maxWait: 5000,
          timeout: 10000,
        });
      } catch (error) {
        if (isPointsTypeMigrationMismatchError(error)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              "DB migratsiya qo'llanmagan: kasr ballar uchun `points` ustuni yangilanmagan. `20260428093000_allow_fractional_amaliy_points` migratsiyasini deploy qiling.",
          });
        }
        if (isTransactionClosedError(error)) {
          throw new TRPCError({
            code: 'TIMEOUT',
            message: "Saqlash vaqtida ulanish uzildi, qayta urinib ko'ring",
          });
        }
        throw error;
      }
    }),

  saveExerciseSlots: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        exerciseDefinitionId: z.string(),
        courseRunId: z.string(),
        slots: z.array(
          z.object({
            date: z.string(),
            colorOptionId: z.string().nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isManagerOrAdmin =
        user.roles.includes('Admin') ||
        user.roles.includes('Manager');
      if (!isManagerOrAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Faqat menejer yoki adminlar uchun' });
      }

      const [definition, courseRun] = await Promise.all([
        prisma.exerciseDefinition.findFirst({
          where: { id: input.exerciseDefinitionId, tenantId, isActive: true },
          select: { id: true, courseId: true, type: true, targetCount: true },
        }),
        prisma.courseRun.findFirst({
          where: { id: input.courseRunId, tenantId },
          select: { id: true, courseId: true, startDate: true, endDate: true },
        }).catch((error) => {
          if (isMissingCourseRunsTableError(error)) {
            return null;
          }
          throw error;
        }),
      ]);

      if (!definition) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mashq topilmadi' });
      }
      if (!courseRun) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }
      if (definition.courseId !== courseRun.courseId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mashq va oqim mos emas' });
      }
      const runCustomerIds = await resolveCourseRunCustomerIds({
        tenantId,
        courseRunId: courseRun.id,
        courseId: courseRun.courseId,
      });
      if (!runCustomerIds.includes(input.customerId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi oqimda topilmadi" });
      }

      const slotInfo = buildExerciseSlotDates({
        startDate: courseRun.startDate,
        endDate: courseRun.endDate,
        type: definition.type,
        targetCount: definition.targetCount,
      });
      const allowedDateKeys = new Set(slotInfo.slotDates.map((date) => toDateKeyLocal(date)));

      const uniqueIncoming = new Map<string, string | null>();
      for (const row of input.slots) {
        const parsed = parseDateInput(row.date);
        const dateKey = toDateKeyLocal(parsed);
        if (!allowedDateKeys.has(dateKey)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ruxsat etilmagan sana yuborildi' });
        }
        uniqueIncoming.set(dateKey, row.colorOptionId);
      }

      const selectedEntries = Array.from(uniqueIncoming.entries())
        .filter(([, colorOptionId]) => Boolean(colorOptionId))
        .map(([date, colorOptionId]) => ({ date, colorOptionId: colorOptionId as string }));

      if (selectedEntries.length > definition.targetCount) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Bu mashq uchun maksimal ${definition.targetCount} marta saqlash mumkin`,
        });
      }

      const colorOptionIds = Array.from(new Set(selectedEntries.map((row) => row.colorOptionId)));
      const colorOptions = colorOptionIds.length > 0
        ? await prisma.exerciseColorOption.findMany({
            where: {
              tenantId,
              id: { in: colorOptionIds },
              isActive: true,
            },
            select: { id: true, colorHex: true },
          })
        : [];
      const colorOptionMap = new Map(colorOptions.map((row) => [row.id, row]));
      if (colorOptionMap.size !== colorOptionIds.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ranglar ro\'yxati noto\'g\'ri' });
      }

      const definitionColorPoints = colorOptionIds.length > 0
        ? await prisma.exerciseDefinitionColorPoint.findMany({
            where: {
              tenantId,
              exerciseDefinitionId: definition.id,
              colorOptionId: { in: colorOptionIds },
            },
            select: { colorOptionId: true, points: true },
          })
        : [];
      const definitionColorPointMap = new Map(definitionColorPoints.map((row) => [row.colorOptionId, row.points]));
      if (definitionColorPointMap.size !== colorOptionIds.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ushbu mashq uchun ba\'zi ranglar sozlanmagan' });
      }

      const runStart = startOfDayLocal(courseRun.startDate);
      const runEndExclusive = addDaysLocal(startOfDayLocal(courseRun.endDate), 1);
      const createRows = selectedEntries.map((row) => {
        const dayStart = startOfDayLocal(parseDateInput(row.date));
        const colorOption = colorOptionMap.get(row.colorOptionId)!;
        const points = definitionColorPointMap.get(row.colorOptionId)!;
        return {
          tenantId,
          customerId: input.customerId,
          exerciseDefinitionId: definition.id,
          colorOptionId: row.colorOptionId,
          colorHex: colorOption.colorHex,
          points,
          completedAt: dayStart,
          loggedByUserId: user.userId,
        };
      });

      try {
        const operations = [
          prisma.studentExerciseLog.deleteMany({
            where: {
              tenantId,
              customerId: input.customerId,
              exerciseDefinitionId: definition.id,
              completedAt: { gte: runStart, lt: runEndExclusive },
            },
          }),
          ...(createRows.length > 0
            ? [prisma.studentExerciseLog.createMany({ data: createRows })]
            : []),
        ];

        const result = await prisma.$transaction(operations);
        const deletedCount = result[0]?.count ?? 0;
        const savedCount = result.length > 1 ? (result[1] as { count: number }).count : 0;
        return {
          success: true,
          savedCount,
          deletedCount,
        };
      } catch (error) {
        if (isPointsTypeMigrationMismatchError(error)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              "DB migratsiya qo'llanmagan: kasr ballar uchun `points` ustuni yangilanmagan. `20260428093000_allow_fractional_amaliy_points` migratsiyasini deploy qiling.",
          });
        }
        if (isTransactionClosedError(error)) {
          throw new TRPCError({
            code: 'TIMEOUT',
            message: "Saqlash vaqtida ulanish uzildi, qayta urinib ko'ring",
          });
        }
        throw error;
      }
    }),

  removeExerciseLog: protectedProcedure
    .input(z.object({ logId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKuratorOnly =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      const log = await prisma.studentExerciseLog.findFirst({
        where: { id: input.logId, tenantId },
        select: { id: true, customerId: true, loggedByUserId: true },
      });
      if (!log) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Yozuv topilmadi' });
      }

      if (isKuratorOnly && log.loggedByUserId !== user.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Faqat o'zingiz kiritgan yozuvni o'chira olasiz" });
      }

      await prisma.studentExerciseLog.delete({ where: { id: input.logId } });
      return { success: true };
    }),

  listRecentLogs: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        date: z.string(),
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      if (isKurator) {
        const allowed = await kuratorCanAccessCustomer({
          tenantId,
          kuratorUserId: user.userId,
          customerId: input.customerId,
          courseRunId: input.courseRunId,
        });
        if (!allowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      const date = parseDateInput(input.date);
      const dayStart = startOfDayLocal(date);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      let courseIdFilter: string | undefined;
      if (input.courseRunId) {
        const selectedRun = await prisma.courseRun
          .findFirst({
            where: { id: input.courseRunId, tenantId },
            select: { courseId: true },
          })
          .catch((error) => {
            if (isMissingCourseRunsTableError(error)) {
              return null;
            }
            throw error;
          });

        if (!selectedRun) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
        }
        courseIdFilter = selectedRun.courseId;
      }

      const logs = await prisma.studentExerciseLog.findMany({
        where: {
          tenantId,
          customerId: input.customerId,
          completedAt: { gte: dayStart, lt: dayEnd },
          ...(courseIdFilter
            ? { exerciseDefinition: { courseId: courseIdFilter } }
            : {}),
        },
        select: {
          id: true,
          exerciseDefinitionId: true,
          colorOptionId: true,
          colorHex: true,
          points: true,
          completedAt: true,
          loggedByUserId: true,
          loggedBy: { select: { id: true, name: true, username: true } },
        },
        orderBy: { completedAt: 'desc' },
      });

      return logs.map((log) => ({
        id: log.id,
        exerciseDefinitionId: log.exerciseDefinitionId,
        colorOptionId: log.colorOptionId,
        colorHex: log.colorHex,
        points: log.points,
        completedAt: log.completedAt,
        loggedByUserId: log.loggedByUserId,
        loggedByName: log.loggedBy?.name ?? log.loggedBy?.username ?? null,
      }));
    }),

  markAttendance: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        courseRunId: z.string(),
        lessonDate: z.string(),
        lessonType: z.enum(['base', 'premium_extra']).default('base'),
        attended: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      const courseRun = await prisma.courseRun
        .findFirst({
          where: {
            id: input.courseRunId,
            tenantId,
          },
          select: { id: true },
        })
        .catch((error) => {
          if (isMissingCourseRunsTableError(error)) {
            return null;
          }
          throw error;
        });

      if (!courseRun) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });
      }

      if (isKurator) {
        const allowed = await kuratorCanAccessCustomer({
          tenantId,
          kuratorUserId: user.userId,
          customerId: input.customerId,
          courseRunId: courseRun.id,
        });
        if (!allowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      if (input.lessonType === 'premium_extra') {
        const premiumEligible = await getStudentPremiumEligibility(tenantId, input.customerId);
        if (!premiumEligible) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Bu o\'quvchi Premium/VIP qo\'shimcha darslarga mos emas',
          });
        }
      }

      const lessonDate = parseDateInput(input.lessonDate);

      return prisma.classAttendance.upsert({
        where: {
          tenantId_customerId_courseRunId_lessonDate_lessonType: {
            tenantId,
            customerId: input.customerId,
            courseRunId: courseRun.id,
            lessonDate,
            lessonType: input.lessonType,
          },
        },
        create: {
          tenantId,
          customerId: input.customerId,
          courseRunId: courseRun.id,
          lessonDate,
          lessonType: input.lessonType,
          attended: input.attended,
          markedByUserId: user.userId,
        },
        update: {
          attended: input.attended,
          lessonType: input.lessonType,
          markedByUserId: user.userId,
          updatedAt: new Date(),
        },
      });
    }),
});
