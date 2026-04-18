import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';

const ACTIVE_ENROLLMENT_FILTER = {
  type: 'new_sale' as const,
  lifecycleStatus: 'active' as const,
};

type CustomerColumnSupport = {
  telegramUsername: boolean;
  gender: boolean;
  region: boolean;
};

let customerColumnSupportPromise: Promise<CustomerColumnSupport> | null = null;

function isMissingRegionConfigsTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('region_configs') && message.includes('does not exist');
  }
  return message.includes('region_configs');
}

function isMissingCourseRunsTableError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('course_runs') && message.includes('does not exist');
  }
  return message.includes('course_runs');
}

function isMissingCustomerColumnError(
  error: unknown,
  column: 'telegramusername' | 'gender' | 'region',
): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes(`customers.${column}`) && message.includes('does not exist');
  }
  return message.includes(`customers.${column}`);
}

async function detectCustomerColumnSupport(): Promise<CustomerColumnSupport> {
  try {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customers'
        AND column_name IN ('telegramUsername', 'gender', 'region')
    `;
    const existing = new Set(rows.map((row) => row.column_name));
    return {
      telegramUsername: existing.has('telegramUsername'),
      gender: existing.has('gender'),
      region: existing.has('region'),
    };
  } catch {
    // If metadata query is blocked, keep legacy behavior and let runtime queries decide.
    return { telegramUsername: true, gender: true, region: true };
  }
}

async function getCustomerColumnSupport(forceRefresh = false): Promise<CustomerColumnSupport> {
  if (!customerColumnSupportPromise || forceRefresh) {
    customerColumnSupportPromise = detectCustomerColumnSupport();
  }
  return customerColumnSupportPromise;
}

function isPremiumTariffName(name: string | null | undefined): boolean {
  const value = (name || '').toLowerCase();
  return value.includes('premium') || value.includes('vip');
}

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
      let columnSupport = await getCustomerColumnSupport();
      const isKurator =
        user.roles.includes('Kurator') &&
        !user.roles.includes('Admin') &&
        !user.roles.includes('Manager');

      let scopedCustomerIds: string[] | undefined;
      let courseRunCourseId: string | undefined;

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
        courseRunCourseId = selectedRun?.courseId;
      }

      if (input.courseRunId && isKurator) {
        const assignments = await prisma.kuratorAssignment.findMany({
          where: {
            tenantId,
            courseRunId: input.courseRunId,
            isActive: true,
            kuratorUserId: user.userId,
          },
          select: { customerId: true },
        });
        scopedCustomerIds = Array.from(new Set(assignments.map((a) => a.customerId)));
      } else if (isKurator) {
        const assignments = await prisma.kuratorAssignment.findMany({
          where: {
            tenantId,
            kuratorUserId: user.userId,
            isActive: true,
          },
          select: { customerId: true },
        });
        scopedCustomerIds = Array.from(new Set(assignments.map((a) => a.customerId)));
      }

      const incomeFilter: Record<string, unknown> = {
        ...ACTIVE_ENROLLMENT_FILTER,
      };
      if (input.tariffId) incomeFilter.tariffId = input.tariffId;
      if (input.courseId) {
        incomeFilter.courseId = input.courseId;
      } else if (courseRunCourseId) {
        incomeFilter.courseId = courseRunCourseId;
      }

      const buildWhere = (support: CustomerColumnSupport): Record<string, unknown> => ({
        tenantId,
        ...(scopedCustomerIds ? { id: { in: scopedCustomerIds } } : {}),
        ...(support.region && input.region ? { region: input.region } : {}),
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: 'insensitive' as const } },
                { customerNumber: { contains: input.search, mode: 'insensitive' as const } },
                ...(support.telegramUsername
                  ? [{ telegramUsername: { contains: input.search, mode: 'insensitive' as const } }]
                  : []),
              ],
            }
          : {}),
        ...(input.courseId || input.tariffId || courseRunCourseId
          ? {
              incomes: {
                some: incomeFilter,
              },
            }
          : {}),
      });

      const buildCustomerSelect = (support: CustomerColumnSupport) => ({
        id: true,
        customerNumber: true,
        name: true,
        ...(support.telegramUsername ? { telegramUsername: true } : {}),
        ...(support.gender ? { gender: true } : {}),
        ...(support.region ? { region: true } : {}),
        incomes: {
          where: ACTIVE_ENROLLMENT_FILTER,
          select: {
            tariffId: true,
            tariff: { select: { name: true } },
          },
          take: 1,
          orderBy: { entryDate: 'desc' as const },
        },
      });

      const runQuery = async (support: CustomerColumnSupport) => {
        const effectiveWhere = buildWhere(support);

        return Promise.all([
          prisma.customer.findMany({
            where: effectiveWhere,
            select: buildCustomerSelect(support),
            skip: (input.page - 1) * input.limit,
            take: input.limit,
            orderBy: { name: 'asc' },
          }),
          prisma.customer.count({ where: effectiveWhere }),
          input.courseRunId
            ? prisma.courseRun
                .findFirst({
                  where: { id: input.courseRunId, tenantId },
                  select: { id: true, baseLessons: true, premiumExtraLessons: true },
                })
                .catch((error) => {
                  if (isMissingCourseRunsTableError(error)) {
                    return null;
                  }
                  throw error;
                })
            : Promise.resolve(null),
        ]);
      };

      let customers: Array<{
        id: string;
        customerNumber: string;
        name: string;
        telegramUsername?: string | null;
        gender?: string | null;
        region?: string | null;
        incomes: Array<{
          tariffId: string | null;
          tariff: { name: string } | null;
        }>;
      }>;
      let total: number;
      let courseRun: { id: string; baseLessons: number; premiumExtraLessons: number } | null;

      try {
        [customers, total, courseRun] = await runQuery(columnSupport);
      } catch (error) {
        const missingTelegram = isMissingCustomerColumnError(error, 'telegramusername');
        const missingRegion = isMissingCustomerColumnError(error, 'region');
        const missingGender = isMissingCustomerColumnError(error, 'gender');
        if (!missingTelegram && !missingRegion && !missingGender) {
          throw error;
        }

        columnSupport = {
          telegramUsername: missingTelegram ? false : columnSupport.telegramUsername,
          gender: missingGender ? false : columnSupport.gender,
          region: missingRegion ? false : columnSupport.region,
        };
        customerColumnSupportPromise = Promise.resolve(columnSupport);
        [customers, total, courseRun] = await runQuery(columnSupport);
      }

      const customerIds = customers.map((c) => c.id);
      let exerciseStatsByCustomer = new Map<string, Array<{ name: string; done: number; total: number }>>();
      let attendanceByCustomer = new Map<
        string,
        {
          attended: number;
          total: number;
          base: { attended: number; total: number };
          premiumExtra: { attended: number; total: number };
          isPremiumEligible: boolean;
        }
      >();

      if (input.courseRunId && courseRun && customerIds.length > 0) {
        const exerciseDefs = await prisma.exerciseDefinition.findMany({
          where: { tenantId, courseRunId: input.courseRunId, isActive: true },
          select: { id: true, name: true, targetCount: true },
          orderBy: { orderIndex: 'asc' },
        });

        const exerciseDefIds = exerciseDefs.map((def) => def.id);

        const [exerciseCounts, attendanceTotals, attendanceAttended] = await Promise.all([
          exerciseDefIds.length > 0
            ? prisma.studentExerciseLog.groupBy({
                by: ['customerId', 'exerciseDefinitionId'],
                where: {
                  tenantId,
                  customerId: { in: customerIds },
                  exerciseDefinitionId: { in: exerciseDefIds },
                },
                _count: { id: true },
              })
            : Promise.resolve([]),
          prisma.classAttendance.groupBy({
            by: ['customerId', 'lessonType'],
            where: {
              tenantId,
              courseRunId: input.courseRunId,
              customerId: { in: customerIds },
            },
            _count: { id: true },
          }),
          prisma.classAttendance.groupBy({
            by: ['customerId', 'lessonType'],
            where: {
              tenantId,
              courseRunId: input.courseRunId,
              customerId: { in: customerIds },
              attended: true,
            },
            _count: { id: true },
          }),
        ]);

        const doneByCustomerDef = new Map<string, number>();
        for (const row of exerciseCounts) {
          doneByCustomerDef.set(`${row.customerId}:${row.exerciseDefinitionId}`, row._count.id);
        }

        for (const customerId of customerIds) {
          exerciseStatsByCustomer.set(
            customerId,
            exerciseDefs.map((def) => ({
              name: def.name,
              done: doneByCustomerDef.get(`${customerId}:${def.id}`) ?? 0,
              total: def.targetCount,
            })),
          );
        }

        const totalByCustomerLessonType = new Map<string, number>();
        const attendedByCustomerLessonType = new Map<string, number>();

        for (const row of attendanceTotals) {
          totalByCustomerLessonType.set(`${row.customerId}:${row.lessonType}`, row._count.id);
        }
        for (const row of attendanceAttended) {
          attendedByCustomerLessonType.set(`${row.customerId}:${row.lessonType}`, row._count.id);
        }

        for (const customer of customers) {
          const tariffName = customer.incomes[0]?.tariff?.name ?? null;
          const premiumEligible = isPremiumTariffName(tariffName);
          const baseTotalTarget = courseRun?.baseLessons ?? 0;
          const premiumTotalTarget = premiumEligible ? (courseRun?.premiumExtraLessons ?? 0) : 0;

          const baseAttended = attendedByCustomerLessonType.get(`${customer.id}:base`) ?? 0;
          const premiumAttended = attendedByCustomerLessonType.get(`${customer.id}:premium_extra`) ?? 0;

          attendanceByCustomer.set(customer.id, {
            attended: baseAttended + premiumAttended,
            total: baseTotalTarget + premiumTotalTarget,
            base: {
              attended: baseAttended,
              total: baseTotalTarget,
            },
            premiumExtra: {
              attended: premiumAttended,
              total: premiumTotalTarget,
            },
            isPremiumEligible: premiumEligible,
          });
        }
      }

      const enriched = customers.map((customer) => ({
        id: customer.id,
        customerNumber: customer.customerNumber,
        name: customer.name,
        phone: customer.customerNumber,
        telegramUsername: columnSupport.telegramUsername ? (customer.telegramUsername ?? null) : null,
        gender: columnSupport.gender ? (customer.gender ?? null) : null,
        region: columnSupport.region ? (customer.region ?? null) : null,
        tariffName: customer.incomes[0]?.tariff?.name ?? null,
        exerciseStats: exerciseStatsByCustomer.get(customer.id) ?? [],
        attendance:
          attendanceByCustomer.get(customer.id) ??
          {
            attended: 0,
            total: 0,
            base: { attended: 0, total: 0 },
            premiumExtra: { attended: 0, total: 0 },
            isPremiumEligible: false,
          },
      }));

      return {
        data: enriched,
        pagination: { page: input.page, limit: input.limit, total },
      };
    }),

  detail: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      let columnSupport = await getCustomerColumnSupport();
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
          select: { id: true },
        });
        if (!assignment) {
          throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
        }
      }

      const buildDetailSelect = (support: CustomerColumnSupport) => ({
        id: true,
        tenantId: true,
        customerNumber: true,
        name: true,
        ...(support.telegramUsername ? { telegramUsername: true } : {}),
        ...(support.gender ? { gender: true } : {}),
        ...(support.region ? { region: true } : {}),
        createdAt: true,
        updatedAt: true,
        incomes: {
          where: ACTIVE_ENROLLMENT_FILTER,
          include: { tariff: true, course: true },
          orderBy: { entryDate: 'desc' as const },
        },
      });

      let customer: {
        id: string;
        tenantId: string;
        customerNumber: string;
        name: string;
        telegramUsername?: string | null;
        gender?: string | null;
        region?: string | null;
        createdAt: Date;
        updatedAt: Date;
        incomes: Array<{
          id: string;
          entryDate: Date;
          course: { id: string; name: string; category: string; tenantId: string; createdAt: Date; updatedAt: Date; isActive: boolean } | null;
          tariff: { id: string; name: string; courseId: string; tenantId: string; createdAt: Date; updatedAt: Date; isActive: boolean } | null;
        }>;
      } | null = null;

      try {
        customer = await prisma.customer.findFirst({
          where: { id: input.customerId, tenantId },
          select: buildDetailSelect(columnSupport),
        });
      } catch (error) {
        const missingTelegram = isMissingCustomerColumnError(error, 'telegramusername');
        const missingRegion = isMissingCustomerColumnError(error, 'region');
        const missingGender = isMissingCustomerColumnError(error, 'gender');
        if (!missingTelegram && !missingRegion && !missingGender) {
          throw error;
        }
        columnSupport = {
          telegramUsername: missingTelegram ? false : columnSupport.telegramUsername,
          gender: missingGender ? false : columnSupport.gender,
          region: missingRegion ? false : columnSupport.region,
        };
        customerColumnSupportPromise = Promise.resolve(columnSupport);
        customer = await prisma.customer.findFirst({
          where: { id: input.customerId, tenantId },
          select: buildDetailSelect(columnSupport),
        });
      }

      if (!customer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
      }

      return {
        ...customer,
        phone: customer.customerNumber,
        telegramUsername: columnSupport.telegramUsername ? (customer.telegramUsername ?? null) : null,
        gender: columnSupport.gender ? (customer.gender ?? null) : null,
        region: columnSupport.region ? (customer.region ?? null) : null,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        name: z.string().min(1).max(160).optional(),
        customerNumber: z.string().optional(),
        phone: z.string().optional(),
        telegramUsername: z.string().optional(),
        gender: z.enum(['male', 'female']).optional(),
        region: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const canEdit = user.roles.includes('Admin') || user.roles.includes('Manager');
      if (!canEdit) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
      }

      const columnSupport = await getCustomerColumnSupport();
      const { customerId, ...data } = input;

      const existing = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
      }

      const syncFields: Record<string, unknown> = {};
      if (data.name !== undefined) syncFields.name = data.name;
      if (data.customerNumber !== undefined) {
        syncFields.customerNumber = data.customerNumber;
      } else if (data.phone !== undefined) {
        syncFields.customerNumber = data.phone;
      }
      if (data.telegramUsername !== undefined && columnSupport.telegramUsername) {
        syncFields.telegramUsername = data.telegramUsername;
      }

      const kdFields: Record<string, unknown> = {};
      if (data.gender !== undefined && columnSupport.gender) kdFields.gender = data.gender;
      if (data.region !== undefined && columnSupport.region) kdFields.region = data.region;

      return prisma.customer.update({
        where: { id: customerId },
        data: { ...syncFields, ...kdFields, updatedAt: new Date() },
      });
    }),

  filterOptions: protectedProcedure.query(async ({ ctx }) => {
    const { tenantId } = ctx;
    const [courses, tariffs] = await Promise.all([
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
    ]);

    let regions: Array<{ id: string; name: string }> = [];
    try {
      regions = await prisma.regionConfig.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    } catch (error) {
      if (!isMissingRegionConfigsTableError(error)) {
        throw error;
      }
      try {
        const customerRegions = await prisma.customer.findMany({
          where: {
            tenantId,
            region: { not: null },
          },
          select: { region: true },
          distinct: ['region'],
          orderBy: { region: 'asc' },
        });

        regions = customerRegions
          .map((row) => row.region?.trim())
          .filter((region): region is string => Boolean(region))
          .map((region) => ({ id: `legacy-${region}`, name: region }));
      } catch (fallbackError) {
        if (!isMissingCustomerColumnError(fallbackError, 'region')) {
          throw fallbackError;
        }
        regions = [];
      }
    }

    return { courses, tariffs, regions };
  }),
});
