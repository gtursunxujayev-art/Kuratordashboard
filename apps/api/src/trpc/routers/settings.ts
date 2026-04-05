import { router, adminProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';

// Offline course: starts Saturday, runs 6 weeks
// Sat + Sun each week = 2 lessons/week × 6 weeks = 12 lessons
// End date = startDate + 41 days (the last Sunday of the 6th week)
function computeEndDate(startDate: Date): Date {
  const end = new Date(startDate);
  end.setDate(end.getDate() + 41); // 6 weeks = 42 days, last day is Sunday at index 41
  return end;
}

export const settingsRouter = router({
  // ── Regions ──────────────────────────────────────────────────────────────
  listRegions: protectedProcedure.query(async ({ ctx }) => {
    return prisma.regionConfig.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: 'asc' },
    });
  }),

  addRegion: adminProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.regionConfig.findFirst({
        where: { tenantId: ctx.tenantId, name: input.name },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Bu nom allaqachon mavjud' });
      }
      return prisma.regionConfig.create({
        data: { tenantId: ctx.tenantId, name: input.name },
      });
    }),

  updateRegion: adminProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(100).optional(), isActive: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return prisma.regionConfig.update({
        where: { id },
        data,
      });
    }),

  // ── Course Runs ───────────────────────────────────────────────────────────
  listCourseRuns: protectedProcedure.query(async ({ ctx }) => {
    return prisma.courseRun.findMany({
      where: { tenantId: ctx.tenantId },
      include: { course: { select: { name: true, category: true } } },
      orderBy: { startDate: 'desc' },
    });
  }),

  createCourseRun: adminProcedure
    .input(
      z.object({
        courseId: z.string(),
        name: z.string().min(1).max(200),
        startDate: z.string(), // ISO date — must be a Saturday
        baseLessons: z.number().int().min(1).max(20).default(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const start = new Date(input.startDate);
      if (start.getDay() !== 6) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Boshlanish sanasi shanba kuni bo'lishi kerak",
        });
      }

      const endDate = computeEndDate(start);

      return prisma.courseRun.create({
        data: {
          tenantId: ctx.tenantId,
          courseId: input.courseId,
          name: input.name,
          startDate: start,
          endDate,
          baseLessons: input.baseLessons,
        },
      });
    }),

  // ── Exercise Definitions ─────────────────────────────────────────────────
  listExerciseDefinitions: protectedProcedure
    .input(z.object({ courseRunId: z.string() }))
    .query(async ({ ctx, input }) => {
      return prisma.exerciseDefinition.findMany({
        where: { tenantId: ctx.tenantId, courseRunId: input.courseRunId },
        orderBy: [{ type: 'asc' }, { orderIndex: 'asc' }],
      });
    }),

  addExerciseDefinition: adminProcedure
    .input(
      z.object({
        courseRunId: z.string(),
        name: z.string().min(1).max(200),
        type: z.enum(['class', 'homework']),
        targetCount: z.number().int().min(1).max(100),
        orderIndex: z.number().int().min(0).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return prisma.exerciseDefinition.create({
        data: {
          tenantId: ctx.tenantId,
          ...input,
        },
      });
    }),

  updateExerciseDefinition: adminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        type: z.enum(['class', 'homework']).optional(),
        targetCount: z.number().int().min(1).max(100).optional(),
        orderIndex: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return prisma.exerciseDefinition.update({ where: { id }, data });
    }),

  // ── Kurator management ───────────────────────────────────────────────────
  listKurators: protectedProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: { tenantId: ctx.tenantId, roles: { has: 'Kurator' }, isActive: true },
      select: { id: true, name: true, username: true, email: true, phone: true },
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
      return prisma.kuratorAssignment.upsert({
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
      await prisma.kuratorAssignment.updateMany({
        where: {
          tenantId: ctx.tenantId,
          kuratorUserId: input.kuratorUserId,
          customerId: input.customerId,
          courseRunId: input.courseRunId,
        },
        data: { isActive: false },
      });
      return { success: true };
    }),

  // ── Courses (read from shared DB) ────────────────────────────────────────
  listCourses: protectedProcedure.query(async ({ ctx }) => {
    return prisma.course.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    });
  }),
});
