import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';

// Returns true if the given date is a Saturday (6) or Sunday (0)
function isClassDay(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// Checks if the given date falls within a course run's class schedule
async function getActiveCourseRun(tenantId: string, date: Date, courseRunId?: string) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return prisma.courseRun.findFirst({
    where: {
      tenantId,
      ...(courseRunId ? { id: courseRunId } : {}),
      startDate: { lte: end },
      endDate: { gte: start },
    },
  });
}

export const amaliyRouter = router({
  // Get students for amaliy page (respects kurator filter)
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
        const assignments = await prisma.kuratorAssignment.findMany({
          where: {
            tenantId,
            kuratorUserId: user.userId,
            isActive: true,
            ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
          },
          select: { customerId: true },
        });
        customerIds = assignments.map((a) => a.customerId);
      }

      return prisma.customer.findMany({
        where: {
          tenantId,
          ...(customerIds ? { id: { in: customerIds } } : {}),
        },
        select: { id: true, name: true, phone: true, telegramUsername: true },
        orderBy: { name: 'asc' },
      });
    }),

  // Get exercises for a student on a specific date
  getStudentExercises: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        date: z.string(), // ISO date string
        courseRunId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');
      const isAdmin = user.roles.includes('Admin');

      if (isKurator) {
        const assignment = await prisma.kuratorAssignment.findFirst({
          where: {
            tenantId,
            kuratorUserId: user.userId,
            customerId: input.customerId,
            isActive: true,
          },
        });
        if (!assignment) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      const date = new Date(input.date);
      const classDay = isClassDay(date);

      // 'all' filter: only for admins
      const exerciseType = classDay ? 'class' : 'homework';

      const courseRun = await getActiveCourseRun(tenantId, date, input.courseRunId);

      if (!courseRun) {
        return {
          isClassDay: classDay,
          exercises: [],
          courseRunId: null,
          dateInfo: { date: input.date, dayOfWeek: date.getDay() },
        };
      }

      const definitions = await prisma.exerciseDefinition.findMany({
        where: {
          tenantId,
          courseRunId: courseRun.id,
          type: exerciseType,
          isActive: true,
        },
        orderBy: { orderIndex: 'asc' },
      });

      // Get logs for this student on this date
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const logs = await prisma.studentExerciseLog.findMany({
        where: {
          tenantId,
          customerId: input.customerId,
          exerciseDefinitionId: { in: definitions.map((d) => d.id) },
          completedAt: { gte: dayStart, lt: dayEnd },
        },
      });

      const logsByDef = new Map(definitions.map((d) => [d.id, 0]));
      for (const log of logs) {
        logsByDef.set(log.exerciseDefinitionId, (logsByDef.get(log.exerciseDefinitionId) ?? 0) + 1);
      }

      // Get total logs (all time) for target count comparison
      const totalLogs = await prisma.studentExerciseLog.groupBy({
        by: ['exerciseDefinitionId'],
        where: {
          tenantId,
          customerId: input.customerId,
          exerciseDefinitionId: { in: definitions.map((d) => d.id) },
        },
        _count: { id: true },
      });
      const totalByDef = new Map(totalLogs.map((l) => [l.exerciseDefinitionId, l._count.id]));

      return {
        isClassDay: classDay,
        exerciseType,
        courseRunId: courseRun.id,
        dateInfo: { date: input.date, dayOfWeek: date.getDay() },
        exercises: definitions.map((def) => ({
          id: def.id,
          name: def.name,
          type: def.type,
          targetCount: def.targetCount,
          doneToday: logsByDef.get(def.id) ?? 0,
          doneTotal: totalByDef.get(def.id) ?? 0,
        })),
        // Also return admin-only 'all' data
        ...(isAdmin
          ? {
              allExercises: await prisma.exerciseDefinition
                .findMany({
                  where: { tenantId, courseRunId: courseRun.id, isActive: true },
                  orderBy: { orderIndex: 'asc' },
                })
                .then((defs) =>
                  defs.map((def) => ({
                    id: def.id,
                    name: def.name,
                    type: def.type,
                    targetCount: def.targetCount,
                    doneTotal: totalByDef.get(def.id) ?? 0,
                  })),
                ),
            }
          : {}),
      };
    }),

  // Log an exercise completion
  logExercise: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        exerciseDefinitionId: z.string(),
        completedAt: z.string(), // ISO date string
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      if (isKurator) {
        const assignment = await prisma.kuratorAssignment.findFirst({
          where: {
            tenantId,
            kuratorUserId: user.userId,
            customerId: input.customerId,
            isActive: true,
          },
        });
        if (!assignment) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      return prisma.studentExerciseLog.create({
        data: {
          tenantId,
          customerId: input.customerId,
          exerciseDefinitionId: input.exerciseDefinitionId,
          completedAt: new Date(input.completedAt),
          loggedByUserId: user.userId,
          note: input.note,
        },
      });
    }),

  // Remove an exercise log
  removeExerciseLog: protectedProcedure
    .input(z.object({ logId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { tenantId } = ctx;
      const log = await prisma.studentExerciseLog.findFirst({
        where: { id: input.logId, tenantId },
      });
      if (!log) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Yozuv topilmadi' });
      }
      await prisma.studentExerciseLog.delete({ where: { id: input.logId } });
      return { success: true };
    }),

  // Mark/update attendance for a class day
  markAttendance: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        courseRunId: z.string(),
        lessonDate: z.string(), // ISO date
        attended: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      if (isKurator) {
        const assignment = await prisma.kuratorAssignment.findFirst({
          where: {
            tenantId,
            kuratorUserId: user.userId,
            customerId: input.customerId,
            courseRunId: input.courseRunId,
            isActive: true,
          },
        });
        if (!assignment) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      const lessonDate = new Date(input.lessonDate);

      return prisma.classAttendance.upsert({
        where: {
          tenantId_customerId_courseRunId_lessonDate: {
            tenantId,
            customerId: input.customerId,
            courseRunId: input.courseRunId,
            lessonDate,
          },
        },
        create: {
          tenantId,
          customerId: input.customerId,
          courseRunId: input.courseRunId,
          lessonDate,
          attended: input.attended,
          markedByUserId: user.userId,
        },
        update: {
          attended: input.attended,
          markedByUserId: user.userId,
          updatedAt: new Date(),
        },
      });
    }),
});
