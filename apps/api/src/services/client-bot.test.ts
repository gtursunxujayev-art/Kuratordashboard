import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { prisma } from '@kuratordashboard/db';
import {
  createClientTelegramLinkToken,
  handleClientBotWebhook,
  issueAttendanceTicket,
  checkInByTicketToken,
  deriveTicketToken,
} from './client-bot';

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('deriveTicketToken', () => {
  const originalSecret = process.env.CLIENT_BOT_WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.CLIENT_BOT_WEBHOOK_SECRET = 'test-secret-for-token-derivation';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CLIENT_BOT_WEBHOOK_SECRET;
    else process.env.CLIENT_BOT_WEBHOOK_SECRET = originalSecret;
  });

  it('is stable for the same tenant/customer/oqim', () => {
    const first = deriveTicketToken('tenant-1', 'customer-1', 'run-1');
    const second = deriveTicketToken('tenant-1', 'customer-1', 'run-1');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{48}$/);
  });

  it('differs per customer and per oqim', () => {
    const base = deriveTicketToken('tenant-1', 'customer-1', 'run-1');
    expect(deriveTicketToken('tenant-1', 'customer-2', 'run-1')).not.toBe(base);
    expect(deriveTicketToken('tenant-1', 'customer-1', 'run-2')).not.toBe(base);
    expect(deriveTicketToken('tenant-2', 'customer-1', 'run-1')).not.toBe(base);
  });
});

describeDatabase('client bot: linking, QR issuance, and check-in', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let tenantId = '';
  let staffUserId = '';
  let customerId = '';
  let offlineCourseRunId = '';
  const originalEnv = {
    token: process.env.CLIENT_BOT_TOKEN,
    webhookSecret: process.env.CLIENT_BOT_WEBHOOK_SECRET,
    username: process.env.CLIENT_BOT_USERNAME,
    tenantEnv: process.env.CLIENT_BOT_TENANT_ID,
  };

  beforeAll(async () => {
    process.env.CLIENT_BOT_TOKEN = 'test-client-bot-token';
    process.env.CLIENT_BOT_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.CLIENT_BOT_USERNAME = 'test_client_bot';

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    })));

    const tenant = await prisma.tenant.create({ data: { name: `client-bot-test-${suffix}` } });
    tenantId = tenant.id;
    process.env.CLIENT_BOT_TENANT_ID = tenantId;

    const staff = await prisma.user.create({
      data: {
        tenantId,
        username: `client-bot-staff-${suffix}`,
        name: 'Staff',
        roles: ['Admin'],
        authProvider: 'local',
      },
    });
    staffUserId = staff.id;

    const customer = await prisma.customer.create({
      data: { tenantId, customerNumber: '998901234567', name: 'Test Client' },
    });
    customerId = customer.id;

    const course = await prisma.course.create({
      data: { tenantId, name: `Offline course ${suffix}`, category: 'offline' },
    });

    // Post-cutover Friday start, 6-week run — gives 12 base lesson slots (Fri+Sat pairs).
    const startDate = new Date(2026, 8, 4); // 2026-09-04, Friday
    const endDate = new Date(2026, 9, 17); // well past the 6-week window
    const run = await prisma.courseRun.create({
      data: {
        tenantId,
        courseId: course.id,
        name: `Run ${suffix}`,
        startDate,
        endDate,
        durationWeeks: 6,
        baseLessons: 12,
      },
    });
    offlineCourseRunId = run.id;

    await prisma.courseRunMember.create({ data: { tenantId, courseRunId: run.id, customerId } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
    if (originalEnv.token === undefined) delete process.env.CLIENT_BOT_TOKEN;
    else process.env.CLIENT_BOT_TOKEN = originalEnv.token;
    if (originalEnv.webhookSecret === undefined) delete process.env.CLIENT_BOT_WEBHOOK_SECRET;
    else process.env.CLIENT_BOT_WEBHOOK_SECRET = originalEnv.webhookSecret;
    if (originalEnv.username === undefined) delete process.env.CLIENT_BOT_USERNAME;
    else process.env.CLIENT_BOT_USERNAME = originalEnv.username;
    if (originalEnv.tenantEnv === undefined) delete process.env.CLIENT_BOT_TENANT_ID;
    else process.env.CLIENT_BOT_TENANT_ID = originalEnv.tenantEnv;
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  it('links a customer via a staff-generated token through the /start webhook flow', async () => {
    const { token } = await createClientTelegramLinkToken(tenantId, customerId, staffUserId);

    const result = await handleClientBotWebhook({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 555111, type: 'private' },
        from: { id: 555111, first_name: 'Test' },
        text: `/start ${token}`,
      },
    });
    expect(result.handled).toBe(true);

    const updated = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(updated.telegramChatId).toBe('555111');
    expect(updated.telegramLinkedAt).not.toBeNull();
  });

  it('rejects reusing an already-consumed link token', async () => {
    const { token } = await createClientTelegramLinkToken(tenantId, customerId, staffUserId);
    await handleClientBotWebhook({
      update_id: 2,
      message: { message_id: 2, chat: { id: 555222, type: 'private' }, from: { id: 555222 }, text: `/start ${token}` },
    });
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });

    await handleClientBotWebhook({
      update_id: 3,
      message: { message_id: 3, chat: { id: 555333, type: 'private' }, from: { id: 555333 }, text: `/start ${token}` },
    });
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(after.telegramChatId).toBe(before.telegramChatId);
  });

  it('issues a QR ticket for an active offline enrollment and records delivery', async () => {
    const result = await issueAttendanceTicket(tenantId, customerId, offlineCourseRunId);
    expect(result.delivered).toBe(true);

    const ticket = await prisma.attendanceTicket.findUniqueOrThrow({
      where: { tenantId_customerId_courseRunId: { tenantId, customerId, courseRunId: offlineCourseRunId } },
    });
    expect(ticket.deliveredAt).not.toBeNull();
  });

  it('rejects an unknown ticket token', async () => {
    const result = await checkInByTicketToken(tenantId, 'does-not-exist-token', staffUserId);
    expect(result).toEqual({ ok: false, status: 'invalid_ticket' });
  });

  it('rejects check-in on a non-class day for this run', async () => {
    const rawToken = `test-ticket-nonclassday-${suffix}`;
    await prisma.attendanceTicket.upsert({
      where: { tenantId_customerId_courseRunId: { tenantId, customerId, courseRunId: offlineCourseRunId } },
      create: { tenantId, customerId, courseRunId: offlineCourseRunId, tokenHash: hashToken(rawToken) },
      update: { tokenHash: hashToken(rawToken), revokedAt: null },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 10, 0, 0)); // 2026-09-08, Tuesday — not a class day

    const result = await checkInByTicketToken(tenantId, rawToken, staffUserId);
    expect(result.status).toBe('not_class_day');
  });

  it('marks attendance with source=qr on a valid class day, then keeps a manual mark on rescan', async () => {
    const rawToken = `test-ticket-classday-${suffix}`;
    await prisma.attendanceTicket.upsert({
      where: { tenantId_customerId_courseRunId: { tenantId, customerId, courseRunId: offlineCourseRunId } },
      create: { tenantId, customerId, courseRunId: offlineCourseRunId, tokenHash: hashToken(rawToken) },
      update: { tokenHash: hashToken(rawToken), revokedAt: null },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 10, 0, 0)); // 2026-09-05, Saturday — first run's class day

    const first = await checkInByTicketToken(tenantId, rawToken, staffUserId);
    expect(first).toMatchObject({ ok: true, status: 'marked', customerName: 'Test Client' });

    const attendance = await prisma.classAttendance.findUniqueOrThrow({
      where: {
        tenantId_customerId_courseRunId_lessonDate_lessonType: {
          tenantId,
          customerId,
          courseRunId: offlineCourseRunId,
          lessonDate: new Date(2026, 8, 5),
          lessonType: 'base',
        },
      },
    });
    expect(attendance).toMatchObject({ source: 'qr', attended: true, status: 'keldi', markedByUserId: staffUserId });

    const second = await checkInByTicketToken(tenantId, rawToken, staffUserId);
    expect(second.status).toBe('already_marked');

    await prisma.classAttendance.update({
      where: { id: attendance.id },
      data: { source: 'manual', markedByUserId: staffUserId },
    });

    const third = await checkInByTicketToken(tenantId, rawToken, staffUserId);
    expect(third.status).toBe('manual_mark_kept');

    const finalRow = await prisma.classAttendance.findUniqueOrThrow({ where: { id: attendance.id } });
    expect(finalRow.source).toBe('manual');
  });
});
