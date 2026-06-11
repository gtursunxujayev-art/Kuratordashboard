import { router, managerProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { extractFaceIdMetaFromPayload } from '../../services/attendance/faceid';

export const faceidRouter = router({
  listRecentEvents: managerProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        status: z.string().optional(),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        phone: z.string().optional(),
        branch: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId } = ctx;
      const { limit, status, dateFrom, dateTo, phone, branch } = input;

      const createdAtFilter: { gte?: Date; lte?: Date } = {};
      if (dateFrom) createdAtFilter.gte = new Date(`${dateFrom}T00:00:00`);
      if (dateTo) createdAtFilter.lte = new Date(`${dateTo}T23:59:59.999`);

      // Fetch a larger slice (up to 200) to support in-memory filtering on JSON fields
      const events = await prisma.webhookEvent.findMany({
        where: {
          tenantId,
          source: 'faceid',
          ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          processedAt: true,
          eventType: true,
          rawPayload: true,
          processed: true,
        },
      });

      let items = events.map((ev) => {
        const meta = extractFaceIdMetaFromPayload(ev.rawPayload);
        return {
          id: ev.id,
          createdAt: ev.createdAt,
          processedAt: ev.processedAt,
          eventType: ev.eventType,
          status: meta.status ?? (ev.processed ? 'processed' : 'processing'),
          phone: meta.phone ?? null,
          externalUserId: meta.externalUserId ?? null,
          customerId: meta.customerId ?? null,
          courseRunId: meta.courseRunId ?? null,
          lessonDate: meta.lessonDate ?? null,
          branchName: meta.branchName ?? null,
          reason: meta.reason ?? null,
        };
      });

      // In-memory filters for fields stored inside JSON
      if (status) {
        items = items.filter((i) => i.status === status);
      }
      if (phone) {
        const normalized = phone.replace(/\D/g, '');
        if (normalized.length >= 4) {
          items = items.filter(
            (i) => i.phone && i.phone.includes(normalized.slice(-Math.min(normalized.length, 9))),
          );
        }
      }
      if (branch) {
        const lower = branch.toLowerCase();
        items = items.filter((i) => i.branchName?.toLowerCase().includes(lower));
      }

      return {
        items: items.slice(0, limit),
        total: items.length,
      };
    }),

  getStatusCounts: managerProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenantId } = ctx;
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const events = await prisma.webhookEvent.findMany({
        where: {
          tenantId,
          source: 'faceid',
          createdAt: { gte: since },
        },
        select: { rawPayload: true },
      });

      const counts: Record<string, number> = {
        marked: 0,
        already_marked: 0,
        manual_mark_kept: 0,
        duplicate: 0,
        no_lesson: 0,
        not_class_day: 0,
        invalid_payload: 0,
        processing: 0,
      };

      for (const ev of events) {
        const meta = extractFaceIdMetaFromPayload(ev.rawPayload);
        const s = meta.status ?? 'processing';
        counts[s] = (counts[s] ?? 0) + 1;
      }

      return counts;
    }),
});
