import { router, protectedProcedure, adminProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';

function isAdminOrManager(roles: string[]): boolean {
  return roles.includes('Admin') || roles.includes('Manager');
}

export const kuratorsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: { tenantId: ctx.tenantId, roles: { has: 'Kurator' }, isActive: true },
      select: { id: true, name: true, username: true, phone: true },
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
    });
  }),

  assignments: protectedProcedure
    .input(
      z.object({
        courseRunId: z.string().optional(),
        kuratorUserId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { user } = ctx;
      const managerScope = isAdminOrManager(user.roles);

      const effectiveKuratorUserId = managerScope
        ? input.kuratorUserId
        : user.userId;

      return prisma.kuratorAssignment.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
          ...(effectiveKuratorUserId ? { kuratorUserId: effectiveKuratorUserId } : {}),
        },
        include: {
          customer: { select: { id: true, name: true } },
          kurator: { select: { id: true, name: true } },
          courseRun: { select: { id: true, name: true } },
        },
      });
    }),

  listTasks: protectedProcedure
    .input(
      z.object({
        kuratorUserId: z.string().optional(),
        status: z.enum(['all', 'pending', 'completed']).default('all'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const managerScope = isAdminOrManager(user.roles);

      const kuratorId = managerScope
        ? input.kuratorUserId
        : user.userId;

      return prisma.kuratorTask.findMany({
        where: {
          tenantId,
          ...(kuratorId ? { kuratorUserId: kuratorId } : {}),
          ...(input.status === 'pending' ? { completedAt: null } : {}),
          ...(input.status === 'completed' ? { completedAt: { not: null } } : {}),
        },
        include: {
          customer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

  createTask: protectedProcedure
    .input(
      z.object({
        kuratorUserId: z.string(),
        customerId: z.string().optional(),
        title: z.string().min(1).max(500),
        dueDate: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const managerScope = isAdminOrManager(user.roles);

      if (!managerScope && input.kuratorUserId !== user.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Faqat o\'zingiz uchun vazifa yarata olasiz' });
      }

      const kurator = await prisma.user.findFirst({
        where: {
          id: input.kuratorUserId,
          tenantId,
          roles: { has: 'Kurator' },
          isActive: true,
        },
        select: { id: true },
      });
      if (!kurator) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurator topilmadi' });
      }

      if (input.customerId) {
        const customer = await prisma.customer.findFirst({
          where: { id: input.customerId, tenantId },
          select: { id: true },
        });
        if (!customer) {
          throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
        }

        if (!managerScope) {
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
            throw new TRPCError({ code: 'FORBIDDEN', message: "Bu o'quvchiga vazifa qo'sha olmaysiz" });
          }
        }
      }

      return prisma.kuratorTask.create({
        data: {
          tenantId,
          kuratorUserId: input.kuratorUserId,
          customerId: input.customerId,
          title: input.title,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        },
      });
    }),

  completeTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const managerScope = isAdminOrManager(user.roles);

      const task = await prisma.kuratorTask.findFirst({
        where: { id: input.taskId, tenantId },
        select: { id: true, kuratorUserId: true },
      });
      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vazifa topilmadi' });
      }

      if (!managerScope && task.kuratorUserId !== user.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Boshqa kurator vazifasini o'zgartira olmaysiz" });
      }

      return prisma.kuratorTask.update({
        where: { id: task.id },
        data: { completedAt: new Date(), updatedAt: new Date() },
      });
    }),

  deleteTask: adminProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await prisma.kuratorTask.findFirst({
        where: { id: input.taskId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vazifa topilmadi' });
      }

      await prisma.kuratorTask.delete({ where: { id: task.id } });
      return { success: true };
    }),
});
