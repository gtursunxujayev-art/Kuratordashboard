import { TRPCError } from '@trpc/server';
import { prisma } from '@kuratordashboard/db';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { addDaysLocal, startOfDayLocal } from '../../utils/date-local';
import { finalizeExpiredIntensiveTransitAttendance, sendIntensivePaymentReceipt } from '../../services/intensive-payments';
import { managerProcedure, router } from '../trpc';

const ACTIVE_SALE = { type: 'new_sale', lifecycleStatus: 'active' } as const;
const attendanceStatusSchema = z.enum(['keldi', 'kelmadi', 'yolda']);

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
      const [attendanceRows, payments] = await Promise.all([
        selectedSales.length ? prisma.classAttendance.findMany({
          where: { tenantId: ctx.tenantId, courseRunId: run.id, customerId: { in: selectedSales.map((sale) => sale.customerId) }, lessonType: 'base', lessonDate: { gte: startOfDayLocal(run.startDate), lte: startOfDayLocal(run.endDate) } },
          select: { customerId: true, lessonDate: true, status: true, attended: true },
        }) : Promise.resolve([]),
        saleIds.length ? prisma.income.findMany({
          where: { tenantId: ctx.tenantId, lifecycleStatus: 'active', OR: [{ id: { in: saleIds } }, { relatedDebtIncomeId: { in: saleIds } }] },
          select: { id: true, relatedDebtIncomeId: true, paymentAmount: true },
        }) : Promise.resolve([]),
      ]);
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
            dayOneStatus: attendance.get(`${sale.customerId}:${localDateKey(dayOne)}`) ?? null,
            dayTwoStatus: attendance.get(`${sale.customerId}:${localDateKey(dayTwo)}`) ?? null,
            remainingDebt,
          };
        }),
      };
    }),

  saveAttendance: managerProcedure
    .input(z.object({ saleId: z.string(), dayOneStatus: attendanceStatusSchema, dayTwoStatus: attendanceStatusSchema }))
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
      const days = [
        { date: startOfDayLocal(run.startDate), status: input.dayOneStatus },
        { date: addDaysLocal(startOfDayLocal(run.startDate), 1), status: input.dayTwoStatus },
      ];
      await prisma.$transaction(days.map((day) => prisma.classAttendance.upsert({
        where: { tenantId_customerId_courseRunId_lessonDate_lessonType: { tenantId: ctx.tenantId, customerId: sale.customerId, courseRunId: run.id, lessonDate: day.date, lessonType: 'base' } },
        create: { tenantId: ctx.tenantId, customerId: sale.customerId, courseRunId: run.id, lessonDate: day.date, lessonType: 'base', status: day.status, attended: day.status === 'keldi', source: 'manual', markedByUserId: ctx.user.userId },
        update: { status: day.status, attended: day.status === 'keldi', source: 'manual', markedByUserId: ctx.user.userId },
      })));
      return { success: true };
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
      const telegram = await sendIntensivePaymentReceipt({ tenantId: ctx.tenantId, saleId: result.saleId, repaymentId: result.repaymentId });
      return { ...result, telegram };
    }),
});

export { finalizeExpiredIntensiveTransitAttendance };
