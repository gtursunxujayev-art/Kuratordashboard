import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
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

  checkInByTicket: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(128) }))
    .mutation(async ({ ctx, input }) => {
      return checkInByTicketToken(ctx.tenantId, input.token, ctx.user.userId);
    }),
});
