import { router, adminProcedure, managerProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma, type Prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { hashPassword } from '../../services/auth/password';

const scheduleTemplateSchema = z.object({
  id: z.string().optional(),
  courseCategory: z.string().min(1).max(100),
  durationWeeks: z.number().int().min(1).max(52),
  baseLessons: z.number().int().min(1).max(200),
  premiumExtraLessons: z.number().int().min(0).max(50),
});

const SCHEDULE_TEMPLATES_SETTINGS_KEY = 'scheduleTemplates';

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

function isMissingCustomerPhoneColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('customers.phone') && message.includes('does not exist');
  }
  return message.includes('customers.phone');
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

function isMissingCourseStartDateColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  if (code !== 'P2021' && code !== 'P2022') {
    return message.includes('courses.startdate') && message.includes('does not exist');
  }
  return message.includes('courses.startdate');
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

/**
 * Resolve "who belongs to this run" using the roster-then-fallback rule:
 *   - If the run has any explicit `course_run_members` rows, those are the members.
 *   - Otherwise, every customer with an active `new_sale` income on the run's course is a member.
 */
async function resolveRunMemberCustomerIds(params: {
  tenantId: string;
  courseRunId: string;
  courseId: string;
}): Promise<string[]> {
  const { tenantId, courseRunId, courseId } = params;
  const explicit = await prisma.courseRunMember.findMany({
    where: { tenantId, courseRunId },
    select: { customerId: true },
  });
  if (explicit.length > 0) {
    return explicit.map((row) => row.customerId);
  }
  const enrolled = await prisma.income.findMany({
    where: {
      tenantId,
      courseId,
      type: 'new_sale',
      lifecycleStatus: 'active',
    },
    select: { customerId: true },
    distinct: ['customerId'],
  });
  return enrolled.map((row) => row.customerId).filter((id): id is string => Boolean(id));
}

/**
 * Re-sync the per-customer `kuratorAssignment` cache so it matches the run's current member set.
 * Used by both `attachKuratorToRun` and `updateCourseRun` (when the roster changes on a run that
 * already has a kurator attached).
 */
async function syncKuratorAssignmentsForRun(params: {
  tenantId: string;
  courseRunId: string;
  kuratorUserId: string;
  courseId: string;
}): Promise<number> {
  const { tenantId, courseRunId, kuratorUserId, courseId } = params;
  const memberCustomerIds = await resolveRunMemberCustomerIds({ tenantId, courseRunId, courseId });

  await prisma.$transaction([
    // Deactivate stale rows: rows under any other kurator OR rows for customers no longer in the set.
    prisma.kuratorAssignment.updateMany({
      where: {
        tenantId,
        courseRunId,
        isActive: true,
        OR: [
          { kuratorUserId: { not: kuratorUserId } },
          { customerId: { notIn: memberCustomerIds.length > 0 ? memberCustomerIds : ['__none__'] } },
        ],
      },
      data: { isActive: false },
    }),
    ...memberCustomerIds.map((customerId) =>
      prisma.kuratorAssignment.upsert({
        where: {
          tenantId_kuratorUserId_customerId_courseRunId: {
            tenantId,
            kuratorUserId,
            customerId,
            courseRunId,
          },
        },
        create: {
          tenantId,
          kuratorUserId,
          customerId,
          courseRunId,
          isActive: true,
        },
        update: { isActive: true },
      }),
    ),
  ]);

  return memberCustomerIds.length;
}

export const settingsRouter = router({
  listStaffUsers: adminProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        roles: { hasSome: ['Manager', 'Kurator'] },
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
        role: z.enum(['Manager', 'Kurator']),
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
          roles: { hasSome: ['Manager', 'Kurator'] },
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
    try {
      const runs = await prisma.courseRun.findMany({
        where: { tenantId: ctx.tenantId },
        include: {
          course: { select: { name: true, category: true } },
          kurator: { select: { id: true, name: true, username: true } },
        },
        orderBy: { startDate: 'desc' },
      });

      return Promise.all(
        runs.map(async (run) => {
          const studentCount = (
            await resolveRunMemberCustomerIds({
              tenantId: ctx.tenantId,
              courseRunId: run.id,
              courseId: run.courseId,
            })
          ).length;

          return {
            ...run,
            studentCount,
          };
        }),
      );
    } catch (error) {
      if (!isMissingCourseRunsTableError(error)) {
        throw error;
      }
      return [];
    }
  }),

  createCourseRun: adminProcedure
    .input(
      z.object({
        courseId: z.string(),
        name: z.string().min(1).max(200),
        durationWeeks: z.number().int().min(1).max(52).optional(),
        baseLessons: z.number().int().min(1).max(200).optional(),
        premiumExtraLessons: z.number().int().min(0).max(50).optional(),
        // Explicit hand-picked roster. When provided & non-empty, becomes the source of truth
        // for "who is in this run". When empty/omitted, callers fall back to "all customers
        // with an active new_sale income on the run's course" (the default-group behavior).
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

      let start: Date;
      try {
        const rows = await prisma.$queryRaw<Array<{ startDate: Date | string | null }>>`
          SELECT "startDate"
          FROM "courses"
          WHERE "id" = ${input.courseId}
            AND "tenantId" = ${ctx.tenantId}
          LIMIT 1
        `;

        const rawStartDate = rows[0]?.startDate;
        if (!rawStartDate) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Kursning boshlanish sanasi topilmadi. Avval kurs start date ni kiriting.",
          });
        }

        start = rawStartDate instanceof Date ? rawStartDate : new Date(String(rawStartDate));
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        if (isMissingCourseStartDateColumnError(error)) {
          throwMissingCourseStartDateMigrationError();
        }
        throw error;
      }

      if (Number.isNaN(start.getTime())) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Kursning boshlanish sanasi noto'g'ri" });
      }
      if (start.getDay() !== 6) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Kursning boshlanish sanasi shanba kuni bo'lishi kerak",
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
      const endDate = computeEndDate(start, durationWeeks);

      const rosterIds = Array.from(new Set(input.customerIds ?? []));
      if (rosterIds.length > 0) {
        const validCustomers = await prisma.customer.findMany({
          where: { tenantId: ctx.tenantId, id: { in: rosterIds } },
          select: { id: true },
        });
        if (validCustomers.length !== rosterIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Tanlangan o'quvchilarning ba'zilari topilmadi",
          });
        }
      }

      try {
        const created = await prisma.courseRun.create({
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

        if (rosterIds.length > 0) {
          await prisma.courseRunMember.createMany({
            data: rosterIds.map((customerId) => ({
              tenantId: ctx.tenantId,
              courseRunId: created.id,
              customerId,
            })),
            skipDuplicates: true,
          });
        }

        return created;
      } catch (error) {
        if (isMissingCourseRunsTableError(error)) {
          throwMissingCourseRunsMigrationError();
        }
        throw error;
      }
    }),

  updateCourseRun: adminProcedure
    .input(
      z.object({
        courseRunId: z.string(),
        name: z.string().min(1).max(200).optional(),
        durationWeeks: z.number().int().min(1).max(52).optional(),
        baseLessons: z.number().int().min(1).max(200).optional(),
        premiumExtraLessons: z.number().int().min(0).max(50).optional(),
        // Replace the run's roster wholesale. When omitted, roster is left untouched.
        // When provided as [], the roster is cleared and the run reverts to default-group
        // behavior (all enrolled customers on the course).
        customerIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.courseRun
        .findFirst({
          where: { id: input.courseRunId, tenantId: ctx.tenantId },
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

      const nextDurationWeeks = input.durationWeeks ?? existing.durationWeeks;
      const durationChanged = input.durationWeeks !== undefined && input.durationWeeks !== existing.durationWeeks;
      const nextEndDate = durationChanged
        ? computeEndDate(existing.startDate, nextDurationWeeks)
        : existing.endDate;

      const rosterIds = input.customerIds === undefined ? null : Array.from(new Set(input.customerIds));
      if (rosterIds && rosterIds.length > 0) {
        const validCustomers = await prisma.customer.findMany({
          where: { tenantId: ctx.tenantId, id: { in: rosterIds } },
          select: { id: true },
        });
        if (validCustomers.length !== rosterIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Tanlangan o'quvchilarning ba'zilari topilmadi",
          });
        }
      }

      try {
        const updated = await prisma.courseRun.update({
          where: { id: input.courseRunId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.durationWeeks !== undefined ? { durationWeeks: nextDurationWeeks } : {}),
            ...(input.baseLessons !== undefined ? { baseLessons: input.baseLessons } : {}),
            ...(input.premiumExtraLessons !== undefined
              ? { premiumExtraLessons: input.premiumExtraLessons }
              : {}),
            ...(durationChanged ? { endDate: nextEndDate } : {}),
          },
        });

        if (rosterIds !== null) {
          // Replace roster wholesale in a transaction.
          await prisma.$transaction([
            prisma.courseRunMember.deleteMany({
              where: { tenantId: ctx.tenantId, courseRunId: input.courseRunId },
            }),
            ...(rosterIds.length > 0
              ? [
                  prisma.courseRunMember.createMany({
                    data: rosterIds.map((customerId) => ({
                      tenantId: ctx.tenantId,
                      courseRunId: input.courseRunId,
                      customerId,
                    })),
                    skipDuplicates: true,
                  }),
                ]
              : []),
          ]);

          // If a kurator is already attached, re-sync their per-customer assignment cache
          // so it matches the new roster (or the new default-group set when roster cleared).
          if (existing.kuratorUserId) {
            await syncKuratorAssignmentsForRun({
              tenantId: ctx.tenantId,
              courseRunId: input.courseRunId,
              kuratorUserId: existing.kuratorUserId,
              courseId: existing.courseId,
            });
          }
        }

        return updated;
      } catch (error) {
        if (isMissingCourseRunsTableError(error)) {
          throwMissingCourseRunsMigrationError();
        }
        throw error;
      }
    }),

  deleteCourseRun: adminProcedure
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
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi' });
      }

      return prisma.exerciseDefinition.findMany({
        where: { tenantId: ctx.tenantId, courseId: input.courseId },
        include: {
          colorPoints: {
            include: {
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
      }).then((rows) =>
        rows.map((row) => ({
          ...row,
          colorPoints: row.colorPoints.sort((left, right) => {
            const leftOrder = left.colorOption.orderIndex ?? 0;
            const rightOrder = right.colorOption.orderIndex ?? 0;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return left.colorOption.label.localeCompare(right.colorOption.label);
          }),
        })),
      );
    }),

  addExerciseDefinition: managerProcedure
    .input(
      z.object({
        courseId: z.string(),
        name: z.string().min(1).max(200),
        type: z.enum(['class', 'homework']),
        targetCount: z.number().int().min(1).max(100),
        orderIndex: z.number().int().min(0).default(0),
        colorPoints: z.array(
          z.object({
            colorOptionId: z.string(),
            points: z.number().min(0).max(10000),
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

      const created = await prisma.$transaction(async (tx) => {
        const definition = await tx.exerciseDefinition.create({
          data: {
            tenantId: ctx.tenantId,
            courseId: course.id,
            name: input.name,
            type: input.type,
            targetCount: input.targetCount,
            orderIndex: input.orderIndex,
          },
        });

        await tx.exerciseDefinitionColorPoint.createMany({
          data: input.colorPoints.map((row) => ({
            tenantId: ctx.tenantId,
            exerciseDefinitionId: definition.id,
            colorOptionId: row.colorOptionId,
            points: row.points,
          })),
        });

        return definition;
      });

      return created;
    }),

  updateExerciseDefinition: managerProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        type: z.enum(['class', 'homework']).optional(),
        targetCount: z.number().int().min(1).max(100).optional(),
        orderIndex: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
        colorPoints: z.array(
          z.object({
            colorOptionId: z.string(),
            points: z.number().min(0).max(10000),
          }),
        ).optional(),
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

      const { id, colorPoints, ...data } = input;

      if (!colorPoints) {
        return prisma.exerciseDefinition.update({ where: { id }, data });
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

      await prisma.$transaction(async (tx) => {
        await tx.exerciseDefinition.update({ where: { id }, data });
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
      });

      return prisma.exerciseDefinition.findUniqueOrThrow({ where: { id } });
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
        prisma.courseRun
          .findFirst({
            where: { id: input.courseRunId, tenantId: ctx.tenantId },
            select: { id: true },
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

  attachKuratorToRun: adminProcedure
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
          roles: { has: 'Kurator' },
          isActive: true,
        },
        select: { id: true },
      });
      if (!kurator) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurator topilmadi' });
      }

      // 1. Set the run's kurator first (so future scope queries hit the relation).
      await prisma.courseRun.update({
        where: { id: input.courseRunId },
        data: { kuratorUserId: input.kuratorUserId },
      });

      // 2. Re-sync the per-customer assignment cache from the resolved member set
      //    (explicit roster if non-empty, else default-group of all enrolled customers).
      const syncedCount = await syncKuratorAssignmentsForRun({
        tenantId: ctx.tenantId,
        courseRunId: input.courseRunId,
        kuratorUserId: input.kuratorUserId,
        courseId: courseRun.courseId,
      });

      return {
        runId: input.courseRunId,
        kuratorUserId: input.kuratorUserId,
        syncedCount,
      };
    }),

  /**
   * Returns the explicit roster (customer IDs) for a run. Empty array means the run uses
   * the default-group fallback. Used by the CourseRunsTab edit form to seed checkbox state.
   */
  listCourseRunMembers: adminProcedure
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
  listEnrollableStudents: adminProcedure
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

      const runQuery = async (includePhone: boolean, includeGender: boolean) =>
        prisma.income.findMany({
          where,
          select: {
            customerId: true,
            customer: {
              select: {
                id: true,
                name: true,
                customerNumber: true,
                ...(includePhone ? { phone: true } : {}),
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
          phone?: string | null;
          gender?: string | null;
        } | null;
        tariff: { id: string; name: string } | null;
      }> = [];

      let includePhone = true;
      let includeGender = true;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          incomes = await runQuery(includePhone, includeGender);
          break;
        } catch (error) {
          const missingPhone = includePhone && isMissingCustomerPhoneColumnError(error);
          const missingGender = includeGender && isMissingCustomerGenderColumnError(error);
          if (!missingPhone && !missingGender) {
            throw error;
          }
          if (missingPhone) includePhone = false;
          if (missingGender) includeGender = false;
        }
      }

      return incomes
        .filter((income) => Boolean(income.customerId && income.customer))
        .map((income) => ({
          id: income.customer!.id,
          name: income.customer!.name,
          phone: income.customer?.phone?.trim() || income.customer?.customerNumber || null,
          gender: income.customer?.gender ?? null,
          tariffId: income.tariff?.id ?? null,
          tariffName: income.tariff?.name ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'uz'));
    }),

  detachKuratorFromRun: adminProcedure
    .input(z.object({ courseRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const courseRun = await prisma.courseRun
        .findFirst({
          where: { id: input.courseRunId, tenantId: ctx.tenantId },
          select: { id: true },
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

      await prisma.$transaction([
        prisma.courseRun.update({
          where: { id: input.courseRunId },
          data: { kuratorUserId: null },
        }),
        prisma.kuratorAssignment.updateMany({
          where: {
            tenantId: ctx.tenantId,
            courseRunId: input.courseRunId,
            isActive: true,
          },
          data: { isActive: false },
        }),
      ]);

      return { success: true };
    }),

  listCourses: protectedProcedure.query(async ({ ctx }) => {
    return prisma.course.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
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

  assignStudentsBulk: adminProcedure
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
            roles: { has: 'Kurator' },
            isActive: true,
          },
          select: { id: true },
        }),
        prisma.courseRun
          .findFirst({
            where: { id: input.courseRunId, tenantId: ctx.tenantId },
            select: { id: true },
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

      const validCustomerIds = new Set(customers.map((c) => c.id));
      const missing = uniqueCustomerIds.filter((id) => !validCustomerIds.has(id));
      if (missing.length > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Ba'zi o'quvchilar topilmadi" });
      }

      await prisma.$transaction(
        uniqueCustomerIds.map((customerId) =>
          prisma.kuratorAssignment.upsert({
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
          }),
        ),
      );

      return { assignedCount: uniqueCustomerIds.length };
    }),
});

