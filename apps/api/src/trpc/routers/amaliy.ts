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

      const exercise = await prisma.exerciseDefinition.findFirst({
        where: {
          id: input.exerciseDefinitionId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          courseId: true,
        },
      });

      if (!exercise) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mashq topilmadi' });
      }

      let selectedRunCourseId: string | null = null;
      if (input.courseRunId) {
        const selectedRun = await prisma.courseRun
          .findFirst({
            where: {
              id: input.courseRunId,
              tenantId,
            },
            select: { id: true, courseId: true },
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

      const whereDefinitions = {
        tenantId,
        courseId: courseRun.courseId,
        isActive: true,
        ...(input.mode === 'day' ? { type: classDay ? 'class' : 'homework' } : {}),
      };

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
      const [todayLogs, totalLogs, attendanceTotals, attendanceAttended] = await Promise.all([
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

      return {
        mode: input.mode,
        isClassDay: classDay,
        exerciseType: input.mode === 'day' ? (classDay ? 'class' : 'homework') : 'all',
        courseRunId: courseRun.id,
        dateInfo: { date: input.date, dayOfWeek: date.getDay() },
        exercises: definitions.map((def) => ({
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
        select: { id: true, targetCount: true },
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
        });
      } catch (error) {
        if (isPointsTypeMigrationMismatchError(error)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              "DB migratsiya qo'llanmagan: kasr ballar uchun `points` ustuni yangilanmagan. `20260428093000_allow_fractional_amaliy_points` migratsiyasini deploy qiling.",
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
