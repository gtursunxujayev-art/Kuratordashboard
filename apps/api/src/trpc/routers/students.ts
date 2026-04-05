import { router, protectedProcedure, adminProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';

export const studentsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        courseRunId: z.string().optional(),
        courseId: z.string().optional(),
        tariffId: z.string().optional(),
        region: z.string().optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      // Kurators only see assigned students
      let allowedCustomerIds: string[] | undefined;
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
        allowedCustomerIds = assignments.map((a) => a.customerId);
      }

      const where = {
        tenantId,
        ...(allowedCustomerIds ? { id: { in: allowedCustomerIds } } : {}),
        ...(input.region ? { region: input.region } : {}),
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: 'insensitive' as const } },
                { phone: { contains: input.search, mode: 'insensitive' as const } },
                { telegramUsername: { contains: input.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        // Filter by tariff via income records
        ...(input.tariffId
          ? {
              incomes: {
                some: {
                  tariffId: input.tariffId,
                  type: 'new_sale',
                  lifecycleStatus: { not: 'refunded' },
                },
              },
            }
          : {}),
        // Filter by course via income records
        ...(input.courseId
          ? {
              incomes: {
                some: {
                  courseId: input.courseId,
                  type: 'new_sale',
                  lifecycleStatus: { not: 'refunded' },
                },
              },
            }
          : {}),
      };

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          select: {
            id: true,
            name: true,
            phone: true,
            telegramUsername: true,
            gender: true,
            region: true,
            profileTariffId: true,
            incomes: {
              where: { type: 'new_sale', lifecycleStatus: { not: 'refunded' } },
              select: { tariffId: true, tariff: { select: { name: true } } },
              take: 1,
              orderBy: { entryDate: 'desc' },
            },
          },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          orderBy: { name: 'asc' },
        }),
        prisma.customer.count({ where }),
      ]);

      // For each customer, get exercise stats and attendance
      const courseRunId = input.courseRunId;
      const enriched = await Promise.all(
        customers.map(async (c) => {
          // Get exercise definitions for this course run (if specified)
          let exerciseStats: Array<{ name: string; done: number; total: number }> = [];
          let attendanceStat: { attended: number; total: number } = { attended: 0, total: 0 };

          if (courseRunId) {
            const exerciseDefs = await prisma.exerciseDefinition.findMany({
              where: { tenantId, courseRunId, isActive: true },
              select: { id: true, name: true, targetCount: true },
            });

            exerciseStats = await Promise.all(
              exerciseDefs.map(async (def) => {
                const done = await prisma.studentExerciseLog.count({
                  where: { tenantId, customerId: c.id, exerciseDefinitionId: def.id },
                });
                return { name: def.name, done, total: def.targetCount };
              }),
            );

            const [totalLessons, attendedLessons] = await Promise.all([
              prisma.classAttendance.count({
                where: { tenantId, customerId: c.id, courseRunId },
              }),
              prisma.classAttendance.count({
                where: { tenantId, customerId: c.id, courseRunId, attended: true },
              }),
            ]);
            attendanceStat = { attended: attendedLessons, total: totalLessons };
          }

          return {
            id: c.id,
            name: c.name,
            phone: c.phone,
            telegramUsername: c.telegramUsername,
            gender: c.gender,
            region: c.region,
            tariffName: c.incomes[0]?.tariff?.name ?? null,
            exerciseStats,
            attendance: attendanceStat,
          };
        }),
      );

      return {
        data: enriched,
        pagination: { page: input.page, limit: input.limit, total },
      };
    }),

  detail: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
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
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Ruxsat yo\'q' });
        }
      }

      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, tenantId },
        include: {
          incomes: {
            where: { type: 'new_sale', lifecycleStatus: { not: 'refunded' } },
            include: { tariff: true, course: true },
            orderBy: { entryDate: 'desc' },
          },
        },
      });

      if (!customer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
      }

      return customer;
    }),

  // Admin only: update student info, syncing name/phone/telegram back to shared DB
  update: adminProcedure
    .input(
      z.object({
        customerId: z.string(),
        name: z.string().min(1).max(160).optional(),
        phone: z.string().optional(),
        telegramUsername: z.string().optional(),
        gender: z.enum(['male', 'female']).optional(),
        region: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId } = ctx;
      const { customerId, ...data } = input;

      const existing = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
      }

      // Fields that sync to Dashboarduz's customers table (same DB)
      const syncFields: Record<string, unknown> = {};
      if (data.name !== undefined) syncFields.name = data.name;
      if (data.phone !== undefined) syncFields.phone = data.phone;
      if (data.telegramUsername !== undefined) syncFields.telegramUsername = data.telegramUsername;

      // KD-only fields
      const kdFields: Record<string, unknown> = {};
      if (data.gender !== undefined) kdFields.gender = data.gender;
      if (data.region !== undefined) kdFields.region = data.region;

      const updated = await prisma.customer.update({
        where: { id: customerId },
        data: { ...syncFields, ...kdFields, updatedAt: new Date() },
      });

      return updated;
    }),

  // Get courses and tariffs for filter dropdowns
  filterOptions: protectedProcedure.query(async ({ ctx }) => {
    const { tenantId } = ctx;
    const [courses, tariffs, regions] = await Promise.all([
      prisma.course.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.tariff.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, courseId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.regionConfig.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { courses, tariffs, regions };
  }),
});
