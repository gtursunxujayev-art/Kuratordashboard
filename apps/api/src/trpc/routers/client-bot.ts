import { router, protectedProcedure, managerProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { prisma } from '@kuratordashboard/db';
import { studentsRouter } from './students';
import { hasKuratorRole, isAdminOrManager } from '../../utils/access';
import { kuratorCanAccessCustomer } from '../utils/kuratorScope';
import {
  createClientTelegramLinkToken,
  issueAttendanceTicket,
  issueTicketsForActiveEnrollments,
  generateTicketQrImage,
  checkInByTicketToken,
} from '../../services/client-bot';

async function assertCustomerAccessible(params: {
  tenantId: string;
  userId: string;
  roles: string[];
  customerId: string;
  courseRunId?: string;
}): Promise<void> {
  const isKuratorOnly = hasKuratorRole(params.roles) && !isAdminOrManager(params.roles);
  if (!isKuratorOnly) return;
  const allowed = await kuratorCanAccessCustomer({
    tenantId: params.tenantId,
    kuratorUserId: params.userId,
    customerId: params.customerId,
    courseRunId: params.courseRunId,
  });
  if (!allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Ruxsat yo'q" });
  }
}

export const clientBotRouter = router({
  createLinkToken: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCustomerAccessible({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        roles: ctx.user.roles,
        customerId: input.customerId,
      });
      return createClientTelegramLinkToken(ctx.tenantId, input.customerId, ctx.user.userId);
    }),

  issueTicket: protectedProcedure
    .input(z.object({ customerId: z.string(), courseRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCustomerAccessible({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        roles: ctx.user.roles,
        customerId: input.customerId,
        courseRunId: input.courseRunId,
      });
      return issueAttendanceTicket(ctx.tenantId, input.customerId, input.courseRunId);
    }),

  // Resends a QR ticket for every active offline/intensiv enrollment the customer
  // currently has, without requiring the caller to know a specific courseRunId —
  // used by the "QR yuborish" button on the student detail page.
  resendTickets: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCustomerAccessible({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        roles: ctx.user.roles,
        customerId: input.customerId,
      });
      return issueTicketsForActiveEnrollments(ctx.tenantId, input.customerId);
    }),

  // Returns the QR as a PNG data URL for display/printing in the dashboard.
  generateTicketQr: protectedProcedure
    .input(z.object({ customerId: z.string(), courseRunId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertCustomerAccessible({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        roles: ctx.user.roles,
        customerId: input.customerId,
        courseRunId: input.courseRunId,
      });
      return generateTicketQrImage(ctx.tenantId, input.customerId, input.courseRunId);
    }),

  // Sends QR tickets via the bot to every student matching the Students-page filters.
  // Resolves matches through students.list itself so the set is identical to what the
  // user sees (including kurator scoping and the "Oqimsiz" filter), across all pages.
  sendTicketsToFiltered: managerProcedure
    .input(
      z.object({
        courseRunId: z.string().optional(),
        courseId: z.string().optional(),
        tariffId: z.string().optional(),
        region: z.string().optional(),
        search: z.string().optional(),
        withoutOqim: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const MAX_RECIPIENTS = 2000;
      const PAGE_SIZE = 500;
      const studentsCaller = studentsRouter.createCaller(ctx);

      const customerIds: string[] = [];
      for (let page = 1; customerIds.length < MAX_RECIPIENTS; page += 1) {
        const result = await studentsCaller.list({ ...input, page, limit: PAGE_SIZE });
        customerIds.push(...result.data.map((row) => row.id));
        if (page * PAGE_SIZE >= result.pagination.total) break;
      }

      const customers = await prisma.customer.findMany({
        where: { tenantId: ctx.tenantId, id: { in: customerIds } },
        select: { id: true, telegramChatId: true },
      });
      const linkedIds = customers.filter((c) => c.telegramChatId).map((c) => c.id);

      let sent = 0;
      let noOqim = 0;
      for (const customerId of linkedIds) {
        const { issuedCount } = await issueTicketsForActiveEnrollments(ctx.tenantId, customerId);
        if (issuedCount > 0) sent += 1;
        else noOqim += 1;
        await new Promise((resolve) => setTimeout(resolve, 35));
      }

      return {
        total: customerIds.length,
        sent,
        notLinked: customerIds.length - linkedIds.length,
        noOqim,
        truncated: customerIds.length >= MAX_RECIPIENTS,
      };
    }),

  checkInByTicket: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(128) }))
    .mutation(async ({ ctx, input }) => {
      return checkInByTicketToken(ctx.tenantId, input.token, ctx.user.userId);
    }),
});
