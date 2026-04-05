import { router, protectedProcedure, adminProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';

export const kuratorsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: { tenantId: ctx.tenantId, roles: { has: 'Kurator' }, isActive: true },
      select: { id: true, name: true, username: true, phone: true },
      orderBy: { name: 'asc' },
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
      return prisma.kuratorAssignment.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          ...(input.courseRunId ? { courseRunId: input.courseRunId } : {}),
          ...(input.kuratorUserId ? { kuratorUserId: input.kuratorUserId } : {}),
        },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          kurator: { select: { id: true, name: true } },
          courseRun: { select: { id: true, name: true } },
        },
      });
    }),

  // Tasks management
  listTasks: protectedProcedure
    .input(
      z.object({
        kuratorUserId: z.string().optional(),
        status: z.enum(['all', 'pending', 'completed']).default('all'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId, user } = ctx;
      const kuratorId =
        input.kuratorUserId ??
        (user.roles.includes('Kurator') ? user.userId : undefined);

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
      return prisma.kuratorTask.create({
        data: {
          tenantId: ctx.tenantId,
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
      return prisma.kuratorTask.update({
        where: { id: input.taskId },
        data: { completedAt: new Date(), updatedAt: new Date() },
      });
    }),

  deleteTask: adminProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.kuratorTask.delete({ where: { id: input.taskId } });
      return { success: true };
    }),
});
