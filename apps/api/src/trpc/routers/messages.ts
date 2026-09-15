import { router, managerProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { sendBroadcastMessage } from '../../services/client-bot';

export const messagesRouter = router({
  listRecipients: managerProcedure
    .input(
      z.object({
        courseId: z.string().optional(),
        tariffId: z.string().optional(),
        search: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId } = ctx;
      const where: Record<string, unknown> = {
        tenantId,
        telegramChatId: { not: null },
      };
      if (input.courseId) where.profileCourseId = input.courseId;
      if (input.tariffId) where.profileTariffId = input.tariffId;
      if (input.search?.trim()) {
        const search = input.search.trim();
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { customerNumber: { contains: search, mode: 'insensitive' } },
        ];
      }

      const customers = await prisma.customer.findMany({
        where: where as any,
        select: {
          id: true,
          name: true,
          customerNumber: true,
          telegramChatId: true,
          profileCourseId: true,
          profileTariffId: true,
        },
        orderBy: { name: 'asc' },
        take: 500,
      });

      return customers;
    }),

  send: managerProcedure
    .input(
      z.object({
        text: z.string().min(1).max(4000),
        recipientCustomerIds: z.array(z.string()).min(1).max(500),
        attachment: z
          .object({
            filename: z.string().min(1).max(200),
            mimeType: z.string().min(1).max(100),
            base64: z.string().min(1),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { tenantId } = ctx;

      const recipients = await prisma.customer.findMany({
        where: {
          tenantId,
          id: { in: input.recipientCustomerIds },
          telegramChatId: { not: null },
        },
        select: { id: true, telegramChatId: true },
      });

      if (recipients.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Tanlangan o'quvchilarning hech biri Telegram botga ulanmagan",
        });
      }

      const attachment = input.attachment
        ? {
            buffer: Buffer.from(input.attachment.base64, 'base64'),
            filename: input.attachment.filename,
            mimeType: input.attachment.mimeType,
          }
        : null;

      const result = await sendBroadcastMessage({
        text: input.text,
        attachment,
        recipients: recipients.map((r) => ({ id: r.id, telegramChatId: r.telegramChatId as string })),
      });

      return {
        ...result,
        skipped: input.recipientCustomerIds.length - recipients.length,
      };
    }),
});
