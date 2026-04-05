import { router, adminProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';

const scheduleTemplateSchema = z.object({
  courseCategory: z.string().min(1).max(100),
  durationWeeks: z.number().int().min(1).max(52),
  baseLessons: z.number().int().min(1).max(200),
  premiumExtraLessons: z.number().int().min(0).max(50),
});

function isMissingRegionConfigsTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('region_configs') && message.includes('does not exist');
  }
  return message.includes('region_configs');
}

function throwMissingRegionsMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message:
      "Region sozlamalari uchun DB migratsiya qo'llanmagan (`region_configs`). Avval migration deploy qiling.",
  });
}

function computeEndDate(startDate: Date, durationWeeks: number): Date {
  // Saturday start + ((weeks * 7) - 6) gives the last Sunday.
  const end = new Date(startDate);
  end.setDate(end.getDate() + (durationWeeks * 7 - 6));
  return end;
}

export const settingsRouter = router({
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
    return prisma.courseScheduleTemplate.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { courseCategory: 'asc' },
    });
  }),

  upsertScheduleTemplate: adminProcedure
    .input(scheduleTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      return prisma.courseScheduleTemplate.upsert({
        where: {
          tenantId_courseCategory: {
            tenantId: ctx.tenantId,
            courseCategory: input.courseCategory,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          courseCategory: input.courseCategory,
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
    }),

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
        startDate: z.string(),
        durationWeeks: z.number().int().min(1).max(52).optional(),
        baseLessons: z.number().int().min(1).max(200).optional(),
        premiumExtraLessons: z.number().int().min(0).max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const start = new Date(input.startDate);
      if (Number.isNaN(start.getTime())) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sana noto\'g\'ri formatda' });
      }
      if (start.getDay() !== 6) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Boshlanish sanasi shanba kuni bo'lishi kerak",
        });
      }

      const course = await prisma.course.findFirst({
        where: { id: input.courseId, tenantId: ctx.tenantId },
        select: { id: true, category: true },
      });
      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi' });
      }

      const template = await prisma.courseScheduleTemplate.findFirst({
        where: { tenantId: ctx.tenantId, courseCategory: course.category },
        select: { durationWeeks: true, baseLessons: true, premiumExtraLessons: true },
      });

      const durationWeeks = input.durationWeeks ?? template?.durationWeeks ?? 6;
      const baseLessons = input.baseLessons ?? template?.baseLessons ?? 12;
      const premiumExtraLessons = input.premiumExtraLessons ?? template?.premiumExtraLessons ?? 2;
      const endDate = computeEndDate(start, durationWeeks);

      return prisma.courseRun.create({
        data: {
          tenantId: ctx.tenantId,
          courseId: input.courseId,
          name: input.name,
          startDate: start,
          endDate,
          durationWeeks,
          baseLessons,
          premiumExtraLessons,
        },
      });
    }),

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
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.exerciseDefinition.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Mashq topilmadi' });
      }

      const { id, ...data } = input;
      return prisma.exerciseDefinition.update({ where: { id }, data });
    }),

  listKurators: protectedProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: { tenantId: ctx.tenantId, roles: { has: 'Kurator' }, isActive: true },
      select: { id: true, name: true, username: true, email: true, phone: true },
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
            roles: { has: 'Kurator' },
            isActive: true,
          },
          select: { id: true },
        }),
        prisma.customer.findFirst({
          where: { id: input.customerId, tenantId: ctx.tenantId },
          select: { id: true },
        }),
        prisma.courseRun.findFirst({
          where: { id: input.courseRunId, tenantId: ctx.tenantId },
          select: { id: true },
        }),
      ]);

      if (!kurator) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurator topilmadi' });
      if (!customer) throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
      if (!courseRun) throw new TRPCError({ code: 'NOT_FOUND', message: 'Oqim topilmadi' });

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

  listCourses: protectedProcedure.query(async ({ ctx }) => {
    return prisma.course.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
    });
  }),
});
