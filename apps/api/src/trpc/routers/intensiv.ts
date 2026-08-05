import { TRPCError } from '@trpc/server';
import { prisma } from '@kuratordashboard/db';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { addDaysLocal, startOfDayLocal } from '../../utils/date-local';
import { finalizeExpiredIntensiveTransitAttendance, sendIntensivePaymentReceipt } from '../../services/intensive-payments';
import { managerProcedure, router } from '../trpc';

const ACTIVE_SALE = { type: 'new_sale', lifecycleStatus: 'active' } as const;
const attendanceStatusSchema = z.enum(['keldi', 'kelmadi', 'yolda']);
const SALES_MANAGER_ROLES = ['Admin', 'Manager', 'TeamLeader', 'Agent', 'OnlineAgent', 'OfflineAgent'] as const;
const SALES_MANAGER_ROLE_TOKENS = new Set(SALES_MANAGER_ROLES.map((role) => role.toLowerCase()));
const MAX_MONEY_AMOUNT = 2_147_483_647;

function hasSalesManagerRole(roles: readonly string[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => SALES_MANAGER_ROLE_TOKENS.has(role.trim().toLowerCase()));
}

function displayManagerName(manager: { id: string; name: string | null; username: string | null }): string {
  return manager.name?.trim() || manager.username?.trim() || manager.id;
}

function readSubTariffId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).saleSubTariffId;
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

function toStatus(row: { status: string; attended: boolean }): 'keldi' | 'kelmadi' | 'yolda' {
  if (row.status === 'keldi' || row.status === 'kelmadi' || row.status === 'yolda') return row.status;
  return row.attended ? 'keldi' : 'kelmadi';
}

function localDateKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function requireSystemRun(tenantId: string, courseId: string, tariffId: string) {
  const run = await prisma.courseRun.findFirst({
    where: { tenantId, courseId, tariffId, isSystemManaged: true },
    select: { id: true, startDate: true, endDate: true, courseId: true, tariffId: true },
  });
  if (!run) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Bu Intensiv tarif uchun avtomatik oqim topilmadi. Kursning boshlanish sanasi va migration holatini tekshiring.',
    });
  }
  return run;
}

export const intensivRouter = router({
  managers: managerProcedure.query(async ({ ctx }) => {
    const users = await prisma.user.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, username: true, roles: true },
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
    });

    return users
      .filter((user) => hasSalesManagerRole(user.roles))
      .map(({ id, name, username }) => ({
        id,
        name: displayManagerName({ id, name, username }),
        username,
      }));
  }),

  courses: managerProcedure.query(async ({ ctx }) => prisma.course.findMany({
    where: { tenantId: ctx.tenantId, isActive: true, category: { contains: 'intens', mode: 'insensitive' } },
    select: { id: true, name: true, startDate: true },
    orderBy: { name: 'asc' },
  })),

  tariffs: managerProcedure.input(z.object({ courseId: z.string() })).query(async ({ ctx, input }) =>
    prisma.tariff.findMany({
      where: { tenantId: ctx.tenantId, courseId: input.courseId, isActive: true },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    })),

  subTariffs: managerProcedure.input(z.object({ tariffId: z.string() })).query(async ({ ctx, input }) =>
    prisma.subTariff.findMany({
      where: { tenantId: ctx.tenantId, tariffId: input.tariffId, isActive: true },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    })),

  list: managerProcedure
    .input(z.object({ courseId: z.string(), tariffId: z.string(), subTariffId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, tenantId: ctx.tenantId, isActive: true, category: { contains: 'intens', mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      const tariff = await prisma.tariff.findFirst({
        where: { id: input.tariffId, tenantId: ctx.tenantId, courseId: input.courseId, isActive: true },
        select: { id: true, name: true },
      });
      if (!course || !tariff) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs yoki tarif topilmadi' });
      if (input.subTariffId) {
        const exists = await prisma.subTariff.findFirst({ where: { id: input.subTariffId, tenantId: ctx.tenantId, tariffId: tariff.id, isActive: true }, select: { id: true } });
        if (!exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sub tarif topilmadi' });
      }
      const run = await requireSystemRun(ctx.tenantId, course.id, tariff.id);
      const sales = await prisma.income.findMany({
        where: { tenantId: ctx.tenantId, courseId: course.id, tariffId: tariff.id, ...ACTIVE_SALE },
        select: {
          id: true, customerId: true, entryDate: true, createdAt: true, coursePriceAmount: true, debtAmount: true, paymentAmount: true,
          remainingDebtAmount: true, legacyImportMeta: true,
          customer: { select: { id: true, name: true, customerNumber: true } },
          tariff: { select: { name: true } },
          manager: { select: { name: true, username: true } },
        },
        orderBy: [{ customerId: 'asc' }, { entryDate: 'desc' }, { createdAt: 'desc' }],
      });
      const selectedByCustomer = new Map<string, typeof sales[number]>();
      for (const sale of sales) {
        if (input.subTariffId && readSubTariffId(sale.legacyImportMeta) !== input.subTariffId) continue;
        if (!selectedByCustomer.has(sale.customerId)) selectedByCustomer.set(sale.customerId, sale);
      }
      const selectedSales = Array.from(selectedByCustomer.values());
      const saleIds = selectedSales.map((sale) => sale.id);
      const subTariffIds = Array.from(new Set(selectedSales.map((sale) => readSubTariffId(sale.legacyImportMeta)).filter((id): id is string => Boolean(id))));
      const [attendanceRows, payments, subTariffs] = await Promise.all([
        selectedSales.length ? prisma.classAttendance.findMany({
          where: { tenantId: ctx.tenantId, courseRunId: run.id, customerId: { in: selectedSales.map((sale) => sale.customerId) }, lessonType: 'base', lessonDate: { gte: startOfDayLocal(run.startDate), lte: startOfDayLocal(run.endDate) } },
          select: { customerId: true, lessonDate: true, status: true, attended: true },
        }) : Promise.resolve([]),
        saleIds.length ? prisma.income.findMany({
          where: { tenantId: ctx.tenantId, lifecycleStatus: 'active', OR: [{ id: { in: saleIds } }, { relatedDebtIncomeId: { in: saleIds } }] },
          select: { id: true, relatedDebtIncomeId: true, paymentAmount: true },
        }) : Promise.resolve([]),
        subTariffIds.length ? prisma.subTariff.findMany({
          where: { id: { in: subTariffIds }, tenantId: ctx.tenantId },
          select: { id: true, name: true },
        }) : Promise.resolve([]),
      ]);
      const subTariffNameMap = new Map(subTariffs.map((st) => [st.id, st.name]));
      const paidBySale = new Map<string, number>();
      for (const payment of payments) {
        const saleId = payment.relatedDebtIncomeId || payment.id;
        paidBySale.set(saleId, (paidBySale.get(saleId) ?? 0) + payment.paymentAmount);
      }
      const attendance = new Map<string, 'keldi' | 'kelmadi' | 'yolda'>();
      for (const row of attendanceRows) attendance.set(`${row.customerId}:${localDateKey(row.lessonDate)}`, toStatus(row));
      const dayOne = startOfDayLocal(run.startDate);
      const dayTwo = addDaysLocal(dayOne, 1);
      return {
        courseRunId: run.id,
        dates: { dayOne: localDateKey(dayOne), dayTwo: localDateKey(dayTwo) },
        students: selectedSales.map((sale) => {
          const agreement = sale.coursePriceAmount ?? sale.debtAmount ?? 0;
          const remainingDebt = Math.max(agreement - (paidBySale.get(sale.id) ?? sale.paymentAmount), 0);
          return {
            saleId: sale.id, customerId: sale.customerId, name: sale.customer.name,
            phone: sale.customer.customerNumber,
            tariffName: sale.tariff?.name ?? '-',
            subTariffName: subTariffNameMap.get(readSubTariffId(sale.legacyImportMeta) ?? '') ?? null,
            managerName: sale.manager.name || sale.manager.username || '-',
            dayOneStatus: attendance.get(`${sale.customerId}:${localDateKey(dayOne)}`) ?? null,
            dayTwoStatus: attendance.get(`${sale.customerId}:${localDateKey(dayTwo)}`) ?? null,
            remainingDebt,
          };
        }),
      };
    }),

  createCustomerSale: managerProcedure
    .input(z.object({
      managerUserId: z.string().min(1),
      customerNumber: z.string().min(1).max(64),
      customerName: z.string().trim().min(1).max(160),
      courseId: z.string().min(1),
      tariffId: z.string().min(1),
      subTariffId: z.string().min(1).optional(),
      agreementAmount: z.number().int().min(0).max(MAX_MONEY_AMOUNT),
      paymentAmount: z.number().int().min(0).max(MAX_MONEY_AMOUNT),
    }))
    .mutation(async ({ ctx, input }) => {
      const customerNumber = input.customerNumber.replace(/\D/g, '');
      if (!customerNumber) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Telefon raqami faqat raqamlardan iborat bo\'lishi kerak' });
      }
      if (input.paymentAmount > input.agreementAmount) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "To'lov summasi shartnoma summasidan katta bo'lishi mumkin emas" });
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`intensive-sale:${ctx.tenantId}:${customerNumber}`}))`);

        const [manager, course, tariff, activeSubTariffCount, systemRun] = await Promise.all([
          tx.user.findFirst({
            where: {
              id: input.managerUserId,
              tenantId: ctx.tenantId,
              isActive: true,
            },
            select: { id: true, roles: true },
          }),
          tx.course.findFirst({
            where: {
              id: input.courseId,
              tenantId: ctx.tenantId,
              isActive: true,
              category: { contains: 'intens', mode: 'insensitive' },
            },
            select: { id: true },
          }),
          tx.tariff.findFirst({
            where: {
              id: input.tariffId,
              tenantId: ctx.tenantId,
              courseId: input.courseId,
              isActive: true,
            },
            select: { id: true },
          }),
          tx.subTariff.count({
            where: { tenantId: ctx.tenantId, tariffId: input.tariffId, isActive: true },
          }),
          tx.courseRun.findFirst({
            where: {
              tenantId: ctx.tenantId,
              courseId: input.courseId,
              tariffId: input.tariffId,
              isSystemManaged: true,
            },
            select: { id: true },
          }),
        ]);

        if (!manager || !hasSalesManagerRole(manager.roles)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Faol menejer topilmadi' });
        }
        if (!course || !tariff) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Faol Intensiv kurs yoki tarif topilmadi' });
        if (!systemRun) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Bu Intensiv tarif uchun avtomatik oqim topilmadi',
          });
        }
        if (activeSubTariffCount > 0 && !input.subTariffId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sub tarifni tanlang' });
        }
        if (input.subTariffId) {
          const subTariff = await tx.subTariff.findFirst({
            where: {
              id: input.subTariffId,
              tenantId: ctx.tenantId,
              tariffId: input.tariffId,
              isActive: true,
            },
            select: { id: true },
          });
          if (!subTariff) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Faol sub tarif topilmadi' });
        }

        let customer = await tx.customer.findUnique({
          where: { tenantId_customerNumber: { tenantId: ctx.tenantId, customerNumber } },
          select: { id: true, name: true },
        });
        const customerReused = Boolean(customer);
        if (!customer) {
          customer = await tx.customer.create({
            data: {
              tenantId: ctx.tenantId,
              customerNumber,
              name: input.customerName.trim(),
            },
            select: { id: true, name: true },
          });
        }

        const duplicateSale = await tx.income.findFirst({
          where: {
            tenantId: ctx.tenantId,
            customerId: customer.id,
            courseId: input.courseId,
            tariffId: input.tariffId,
            ...ACTIVE_SALE,
          },
          select: { id: true },
        });
        if (duplicateSale) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Bu mijoz tanlangan kurs va tarifda allaqachon faol',
          });
        }

        const remainingDebt = input.agreementAmount - input.paymentAmount;
        const sale = await tx.income.create({
          data: {
            tenantId: ctx.tenantId,
            customerId: customer.id,
            managerUserId: manager.id,
            type: 'new_sale',
            lifecycleStatus: 'active',
            courseId: course.id,
            tariffId: tariff.id,
            entryDate: new Date(),
            deadline: null,
            coursePriceAmount: input.agreementAmount,
            debtAmount: input.agreementAmount,
            paymentAmount: input.paymentAmount,
            remainingDebtAmount: remainingDebt,
            ...(input.subTariffId
              ? { legacyImportMeta: { saleSubTariffId: input.subTariffId } as Prisma.InputJsonValue }
              : {}),
          },
          select: { id: true },
        });

        await tx.customer.update({
          where: { id: customer.id },
          data: {
            profileCourseId: course.id,
            profileTariffId: tariff.id,
            profileSubTariffId: input.subTariffId ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.user.userId,
            action: 'intensive_sale_create',
            resource: 'income',
            resourceId: sale.id,
            metadata: {
              customerId: customer.id,
              managerUserId: manager.id,
              courseId: course.id,
              tariffId: tariff.id,
              subTariffId: input.subTariffId ?? null,
              agreementAmount: input.agreementAmount,
              paymentAmount: input.paymentAmount,
              customerReused,
            },
          },
        });

        return {
          saleId: sale.id,
          customerId: customer.id,
          customerName: customer.name,
          customerReused,
          remainingDebt,
        };
      }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });

      const telegram = await sendIntensivePaymentReceipt({
        tenantId: ctx.tenantId,
        saleId: result.saleId,
        paymentIncomeId: result.saleId,
      });
      return { ...result, telegram };
    }),

  saveAttendance: managerProcedure
    .input(z.object({
      saleId: z.string(),
      day: z.enum(['dayOne', 'dayTwo']),
      status: attendanceStatusSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const sale = await prisma.income.findFirst({
        where: { id: input.saleId, tenantId: ctx.tenantId, ...ACTIVE_SALE, course: { category: { contains: 'intens', mode: 'insensitive' } } },
        select: { customerId: true, courseId: true, tariffId: true },
      });
      if (!sale?.courseId || !sale.tariffId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Intensiv sotuv topilmadi' });
      const run = await requireSystemRun(ctx.tenantId, sale.courseId, sale.tariffId);
      const membership = await prisma.courseRunMember.findFirst({
        where: { tenantId: ctx.tenantId, courseRunId: run.id, customerId: sale.customerId },
        select: { id: true },
      });
      if (!membership) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "O'quvchi avtomatik Intensiv oqimiga biriktirilmagan" });
      }
      const lessonDate = input.day === 'dayOne'
        ? startOfDayLocal(run.startDate)
        : addDaysLocal(startOfDayLocal(run.startDate), 1);
      await prisma.classAttendance.upsert({
        where: {
          tenantId_customerId_courseRunId_lessonDate_lessonType: {
            tenantId: ctx.tenantId,
            customerId: sale.customerId,
            courseRunId: run.id,
            lessonDate,
            lessonType: 'base',
          },
        },
        create: {
          tenantId: ctx.tenantId,
          customerId: sale.customerId,
          courseRunId: run.id,
          lessonDate,
          lessonType: 'base',
          status: input.status,
          attended: input.status === 'keldi',
          source: 'manual',
          markedByUserId: ctx.user.userId,
        },
        update: {
          status: input.status,
          attended: input.status === 'keldi',
          source: 'manual',
          markedByUserId: ctx.user.userId,
        },
      });
      return { success: true, day: input.day, status: input.status };
    }),

  recordPayment: managerProcedure
    .input(z.object({ saleId: z.string(), amount: z.number().int().positive().max(2_147_483_647) }))
    .mutation(async ({ ctx, input }) => {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`intensive-payment:${input.saleId}`}))`);
        const sale = await tx.income.findFirst({
          where: { id: input.saleId, tenantId: ctx.tenantId, ...ACTIVE_SALE, course: { category: { contains: 'intens', mode: 'insensitive' } } },
          select: { id: true, customerId: true, managerUserId: true, courseId: true, tariffId: true, deadline: true, coursePriceAmount: true, debtAmount: true },
        });
        if (!sale) throw new TRPCError({ code: 'NOT_FOUND', message: 'Intensiv qarzi topilmadi' });
        const chain = await tx.income.findMany({
          where: { tenantId: ctx.tenantId, lifecycleStatus: 'active', OR: [{ id: sale.id }, { relatedDebtIncomeId: sale.id }] },
          select: { paymentAmount: true },
        });
        const agreement = sale.coursePriceAmount ?? sale.debtAmount ?? 0;
        const remainingDebt = Math.max(agreement - chain.reduce((sum, row) => sum + row.paymentAmount, 0), 0);
        if (input.amount > remainingDebt) throw new TRPCError({ code: 'BAD_REQUEST', message: "To'lov summasi qolgan qarzdan katta bo'lishi mumkin emas" });
        if (remainingDebt <= 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bu qarz allaqachon yopilgan' });
        const nextDebt = remainingDebt - input.amount;
        const repayment = await tx.income.create({
          data: { tenantId: ctx.tenantId, customerId: sale.customerId, managerUserId: sale.managerUserId, type: 'repayment', lifecycleStatus: 'active', relatedDebtIncomeId: sale.id, courseId: sale.courseId, tariffId: sale.tariffId, entryDate: new Date(), deadline: sale.deadline, debtAmount: remainingDebt, paymentAmount: input.amount, remainingDebtAmount: nextDebt },
        });
        await tx.income.update({ where: { id: sale.id }, data: { remainingDebtAmount: nextDebt } });
        await tx.auditLog.create({ data: { tenantId: ctx.tenantId, userId: ctx.user.userId, action: 'intensive_repayment_create', resource: 'income', resourceId: repayment.id, metadata: { saleId: sale.id, amount: input.amount, creditedManagerUserId: sale.managerUserId } } });
        return { repaymentId: repayment.id, saleId: sale.id, remainingDebt: nextDebt };
      }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
      const telegram = await sendIntensivePaymentReceipt({ tenantId: ctx.tenantId, saleId: result.saleId, paymentIncomeId: result.repaymentId });
      return { ...result, telegram };
    }),
});

export { finalizeExpiredIntensiveTransitAttendance };
