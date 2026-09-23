import crypto from 'crypto';
import QRCode from 'qrcode';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { startOfDayLocal } from '../utils/date-local';
import { isClassDayForRun, isOfflineLikeCategory } from '../utils/course-schedule';
import { matchCustomerByPhone } from './attendance/customer-matching';
import { buildSlotDateKeys } from './attendance/faceid';

/**
 * Client-facing Telegram bot: students/parents link their Telegram account here to
 * receive a QR attendance ticket and broadcast messages. Fully separate from the
 * staff report bot (telegram-reports.ts) — its own token, webhook secret, and
 * Prisma models (ClientTelegramLinkToken / AttendanceTicket vs TelegramLinkToken /
 * TelegramReportReceiver).
 */

// 7 days: links are generated in bulk for a whole group and handed out over days,
// so a short TTL would expire most of them before students ever tap them.
const LINK_TOKEN_TTL_MINUTES = 60 * 24 * 7;

const ACTIVE_ENROLLMENT_FILTER = {
  type: 'new_sale' as const,
  lifecycleStatus: 'active' as const,
};

// ---------------------------------------------------------------------------
// Config & low-level bot plumbing (mirrors telegram-reports.ts's raw-fetch style)
// ---------------------------------------------------------------------------

function requireClientBotToken(): string {
  const token = process.env.CLIENT_BOT_TOKEN?.trim();
  if (!token) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CLIENT_BOT_TOKEN sozlanmagan' });
  }
  return token;
}

function ensureClientBotConfigured(): { token: string; webhookSecret: string; botUsername: string | null } {
  const token = requireClientBotToken();
  const webhookSecret = process.env.CLIENT_BOT_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'CLIENT_BOT_WEBHOOK_SECRET sozlanmagan' });
  }
  const botUsername = process.env.CLIENT_BOT_USERNAME?.trim() || null;
  return { token, webhookSecret, botUsername };
}

export function getClientBotWebhookSecret(): string | null {
  return process.env.CLIENT_BOT_WEBHOOK_SECRET?.trim() || null;
}

async function clientBotApiCall<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = requireClientBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await response.json()) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.description || `Telegram API error (${response.status})`);
  }
  return json.result as T;
}

export async function sendClientMessage(chatId: string, text: string): Promise<void> {
  await clientBotApiCall('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function sendClientDocument(
  chatId: string,
  filename: string,
  buffer: Buffer,
  caption: string,
  mimeType = 'application/octet-stream',
): Promise<void> {
  const token = requireClientBotToken();
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('document', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  const json = (await response.json()) as { ok?: boolean; description?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.description || `Telegram sendDocument error (${response.status})`);
  }
}

export async function sendClientPhoto(chatId: string, buffer: Buffer, caption: string): Promise<void> {
  const token = requireClientBotToken();
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('photo', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'ticket.png');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const json = (await response.json()) as { ok?: boolean; description?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.description || `Telegram sendPhoto error (${response.status})`);
  }
}

async function resolveClientBotTenantId(): Promise<string | null> {
  const envTenant = process.env.CLIENT_BOT_TENANT_ID?.trim();
  if (envTenant) {
    const tenant = await prisma.tenant.findUnique({ where: { id: envTenant }, select: { id: true } });
    return tenant?.id ?? null;
  }
  const tenants = await prisma.tenant.findMany({ select: { id: true }, take: 2 });
  return tenants.length === 1 ? tenants[0].id : null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toDateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Linking: staff-generated per-client invite token (primary) + phone fallback
// ---------------------------------------------------------------------------

export async function createClientTelegramLinkToken(
  tenantId: string,
  customerId: string,
  createdByUserId: string,
): Promise<{ token: string; deepLink: string | null; expiresAt: Date }> {
  ensureClientBotConfigured();

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true },
  });
  if (!customer) {
    throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
  }

  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MINUTES * 60_000);

  await prisma.clientTelegramLinkToken.create({
    data: { tenantId, customerId, tokenHash, expiresAt, createdByUserId },
  });

  const botUsername = process.env.CLIENT_BOT_USERNAME?.trim() || null;
  return {
    token,
    deepLink: botUsername ? `https://t.me/${botUsername}?start=${token}` : null,
    expiresAt,
  };
}

// Finds active offline/intensiv enrollments for a customer and (re)sends a QR
// ticket for each — used both right after a successful bot link (so a client who
// links after already enrolling gets their ticket immediately) and as the target
// of a staff "resend QR" action from the student detail page.
export async function issueTicketsForActiveEnrollments(tenantId: string, customerId: string): Promise<{ issuedCount: number }> {
  const today = startOfDayLocal(new Date());
  const memberships = await prisma.courseRunMember.findMany({
    where: {
      tenantId,
      customerId,
      courseRun: { endDate: { gte: today } },
    },
    select: {
      courseRun: { select: { id: true, course: { select: { category: true } } } },
    },
  });
  let issuedCount = 0;
  for (const membership of memberships) {
    if (!isOfflineLikeCategory(membership.courseRun.course.category)) continue;
    try {
      await issueAttendanceTicket(tenantId, customerId, membership.courseRun.id);
      issuedCount += 1;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'client_bot_auto_ticket_failed',
          customerId,
          courseRunId: membership.courseRun.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return { issuedCount };
}

async function handleStartWithToken(chatId: string, from: any, chat: any, startToken: string): Promise<void> {
  const tokenHash = hashToken(startToken);
  const link = await prisma.clientTelegramLinkToken.findUnique({
    where: { tokenHash },
    select: { id: true, tenantId: true, customerId: true, usedAt: true, expiresAt: true },
  });
  if (!link || link.usedAt || link.expiresAt.getTime() < Date.now()) {
    await sendClientMessage(chatId, "Havola yaroqsiz yoki muddati tugagan. Administratordan yangi havola so'rang.");
    return;
  }

  const customer = await prisma.customer.findFirst({
    where: { id: link.customerId, tenantId: link.tenantId },
    select: { id: true, name: true },
  });
  if (!customer) {
    await sendClientMessage(chatId, "Havola uchun mos o'quvchi topilmadi.");
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const marked = await tx.clientTelegramLinkToken.updateMany({
        where: { id: link.id, usedAt: null, expiresAt: { gte: new Date() } },
        data: { usedAt: new Date() },
      });
      if (marked.count !== 1) {
        throw new Error('TOKEN_ALREADY_USED_OR_EXPIRED');
      }
      await tx.customer.update({
        where: { id: customer.id },
        data: { telegramChatId: chatId, telegramLinkedAt: new Date() },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'TOKEN_ALREADY_USED_OR_EXPIRED') {
      await sendClientMessage(chatId, "Havola yaroqsiz yoki muddati tugagan. Administratordan yangi havola so'rang.");
      return;
    }
    throw error;
  }

  await sendClientMessage(chatId, `Ulanish muvaffaqiyatli, ${customer.name}! Endi darslaringiz uchun QR chipta shu chatga yuboriladi.`);
  await issueTicketsForActiveEnrollments(link.tenantId, customer.id);
}

async function handleStartWithoutToken(chatId: string): Promise<void> {
  await clientBotApiCall('sendMessage', {
    chat_id: chatId,
    text: "Ro'yxatdan o'tish uchun telefon raqamingizni yuboring.",
    reply_markup: {
      keyboard: [[{ text: 'Raqamni yuborish', request_contact: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    },
  });
}

async function handleContactShare(tenantId: string, chatId: string, phoneNumber: string): Promise<void> {
  const found = await matchCustomerByPhone(phoneNumber, tenantId);
  if (!found) {
    await sendClientMessage(
      chatId,
      "Ushbu raqam bo'yicha o'quvchi topilmadi. Administrator bilan bog'laning yoki ulash havolasini so'rang.",
    );
    return;
  }

  await prisma.customer.update({
    where: { id: found.id },
    data: { telegramChatId: chatId, telegramLinkedAt: new Date() },
  });

  await clientBotApiCall('sendMessage', {
    chat_id: chatId,
    text: 'Ulanish muvaffaqiyatli! Endi darslaringiz uchun QR chipta shu chatga yuboriladi.',
    reply_markup: { remove_keyboard: true },
  });
  await issueTicketsForActiveEnrollments(found.tenantId, found.id);
}

export async function handleClientBotWebhook(update: any): Promise<{ handled: boolean; message?: string }> {
  requireClientBotToken();

  const message = update?.message;
  const chatIdRaw = message?.chat?.id;
  if (!message || !chatIdRaw) {
    return { handled: false, message: 'No message payload' };
  }
  const chatId = String(chatIdRaw);

  const tenantId = await resolveClientBotTenantId();
  if (!tenantId) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'client_bot_configuration_error',
        reason: 'CLIENT_BOT_TENANT_ID_required_unless_exactly_one_tenant_exists',
      }),
    );
    return { handled: false, message: 'Tenant not resolvable' };
  }

  await prisma.webhookEvent
    .create({
      data: {
        tenantId,
        source: 'client_bot',
        eventType: message.contact ? 'contact' : 'message',
        idempotencyKey: crypto
          .createHash('sha256')
          .update(`client_bot:${tenantId}:${update.update_id ?? JSON.stringify(update)}`)
          .digest('hex'),
        rawPayload: update as object,
        processed: true,
        processedAt: new Date(),
      },
    })
    .catch(() => undefined);

  const messageText = String(message.text ?? '').trim();

  if (message.contact?.phone_number) {
    await handleContactShare(tenantId, chatId, String(message.contact.phone_number));
    return { handled: true, message: 'Contact processed' };
  }

  if (messageText.toLowerCase().startsWith('/start')) {
    const parts = messageText.split(/\s+/);
    const startToken = parts[1];
    if (startToken) {
      await handleStartWithToken(chatId, message.from, message.chat, startToken);
    } else {
      await handleStartWithoutToken(chatId);
    }
    return { handled: true, message: 'Start processed' };
  }

  await sendClientMessage(chatId, "Bot ishlayapti. Ro'yxatdan o'tish uchun administrator yuborgan havoladan foydalaning.");
  return { handled: true, message: 'Acknowledged' };
}

// ---------------------------------------------------------------------------
// QR ticket issuance
// ---------------------------------------------------------------------------

export async function issueAttendanceTicket(
  tenantId: string,
  customerId: string,
  courseRunId: string,
): Promise<{ delivered: boolean }> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, name: true, telegramChatId: true },
  });
  if (!customer) {
    throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
  }
  if (!customer.telegramChatId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: "O'quvchi hali Telegram botga ulanmagan",
    });
  }

  const membership = await prisma.courseRunMember.findFirst({
    where: { tenantId, customerId, courseRunId },
    select: {
      courseRun: {
        select: { id: true, name: true, course: { select: { category: true } } },
      },
    },
  });
  if (!membership) {
    throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi ushbu oqimga biriktirilmagan" });
  }
  if (!isOfflineLikeCategory(membership.courseRun.course.category)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'QR chipta faqat oflayn/intensiv kurslar uchun beriladi',
    });
  }

  let existing = await prisma.attendanceTicket.findUnique({
    where: { tenantId_customerId_courseRunId: { tenantId, customerId, courseRunId } },
    select: { id: true, tokenHash: true, revokedAt: true },
  });

  let rawToken: string;
  if (existing && !existing.revokedAt) {
    // Reuse the existing ticket — one static QR per enrollment. The raw token isn't
    // stored, so we can't re-derive it; instead we mint a fresh one and update the
    // hash in place, which keeps the "one ticket per enrollment" invariant while
    // still letting staff re-send a lost QR on request.
    rawToken = crypto.randomBytes(24).toString('hex');
    await prisma.attendanceTicket.update({
      where: { id: existing.id },
      data: { tokenHash: hashToken(rawToken), deliveredAt: null },
    });
  } else {
    rawToken = crypto.randomBytes(24).toString('hex');
    await prisma.attendanceTicket.upsert({
      where: { tenantId_customerId_courseRunId: { tenantId, customerId, courseRunId } },
      create: { tenantId, customerId, courseRunId, tokenHash: hashToken(rawToken) },
      update: { tokenHash: hashToken(rawToken), revokedAt: null, deliveredAt: null },
    });
  }

  const qrBuffer = await QRCode.toBuffer(rawToken, { type: 'png', width: 512, margin: 2 });
  await sendClientPhoto(
    customer.telegramChatId,
    qrBuffer,
    `${customer.name} — ${membership.courseRun.name} davomat chiptasi. Har bir darsda shu QR kodni ko'rsating.`,
  );

  await prisma.attendanceTicket.update({
    where: { tenantId_customerId_courseRunId: { tenantId, customerId, courseRunId } },
    data: { deliveredAt: new Date() },
  });

  return { delivered: true };
}

// Issues (or re-issues) a ticket and returns the QR as a PNG data URL so staff can
// display/print it from the dashboard. Unlike issueAttendanceTicket this does NOT
// require the student to be linked to Telegram — useful for students who don't use
// the bot. Note: the raw token is never stored, so generating a QR mints a new token
// and supersedes any QR previously shown or sent for the same enrollment.
export async function generateTicketQrImage(
  tenantId: string,
  customerId: string,
  courseRunId?: string,
): Promise<{ dataUrl: string; courseRunName: string; customerName: string }> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, name: true },
  });
  if (!customer) {
    throw new TRPCError({ code: 'NOT_FOUND', message: "O'quvchi topilmadi" });
  }

  const today = startOfDayLocal(new Date());
  const membership = await prisma.courseRunMember.findFirst({
    where: {
      tenantId,
      customerId,
      ...(courseRunId ? { courseRunId } : { courseRun: { endDate: { gte: today } } }),
    },
    select: {
      courseRun: {
        select: { id: true, name: true, startDate: true, course: { select: { category: true } } },
      },
    },
    orderBy: { courseRun: { startDate: 'desc' } },
  });

  if (!membership) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: "O'quvchi faol oqimga biriktirilmagan. Avval uni oqim ro'yxatiga qo'shing.",
    });
  }
  if (!isOfflineLikeCategory(membership.courseRun.course.category)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'QR chipta faqat oflayn/intensiv kurslar uchun beriladi',
    });
  }

  const rawToken = crypto.randomBytes(24).toString('hex');
  await prisma.attendanceTicket.upsert({
    where: {
      tenantId_customerId_courseRunId: { tenantId, customerId, courseRunId: membership.courseRun.id },
    },
    create: {
      tenantId,
      customerId,
      courseRunId: membership.courseRun.id,
      tokenHash: hashToken(rawToken),
    },
    update: { tokenHash: hashToken(rawToken), revokedAt: null },
  });

  const dataUrl = await QRCode.toDataURL(rawToken, { width: 512, margin: 2 });
  return { dataUrl, courseRunName: membership.courseRun.name, customerName: customer.name };
}

// ---------------------------------------------------------------------------
// QR check-in (attendance mark by ticket token) — mirrors faceid.ts's
// resolveLesson/markAttendance, keyed by ticket token instead of phone/external-id.
// ---------------------------------------------------------------------------

export type QrCheckInStatus =
  | 'marked'
  | 'already_marked'
  | 'manual_mark_kept'
  | 'invalid_ticket'
  | 'not_class_day'
  | 'no_lesson';

export type QrCheckInResult = {
  ok: boolean;
  status: QrCheckInStatus;
  customerName?: string;
  customerNumber?: string;
  tariffName?: string | null;
  courseName?: string | null;
  agreementAmount?: number;
  remainingDebt?: number;
  lessonDate?: string;
};

// Agreement ("shartnoma") and debt ("qarz") follow the same convention used by the
// intensiv sales flow: the agreement is coursePriceAmount (falling back to
// debtAmount for legacy rows) and the debt is the sale's running remainingDebtAmount.
async function loadEnrollmentSummary(
  tenantId: string,
  customerId: string,
  courseId: string,
): Promise<{ tariffName: string | null; agreementAmount: number; remainingDebt: number }> {
  const sale = await prisma.income.findFirst({
    where: { tenantId, customerId, courseId, ...ACTIVE_ENROLLMENT_FILTER },
    select: {
      coursePriceAmount: true,
      debtAmount: true,
      remainingDebtAmount: true,
      tariff: { select: { name: true } },
    },
    orderBy: { entryDate: 'desc' },
  });

  return {
    tariffName: sale?.tariff?.name ?? null,
    agreementAmount: sale?.coursePriceAmount ?? sale?.debtAmount ?? 0,
    remainingDebt: sale?.remainingDebtAmount ?? 0,
  };
}

async function markQrAttendance(params: {
  tenantId: string;
  customerId: string;
  courseRunId: string;
  lessonDate: Date;
  scannedByUserId: string;
}): Promise<'marked' | 'already_marked' | 'manual_mark_kept'> {
  const { tenantId, customerId, courseRunId, lessonDate, scannedByUserId } = params;

  const existing = await prisma.classAttendance.findUnique({
    where: {
      tenantId_customerId_courseRunId_lessonDate_lessonType: {
        tenantId,
        customerId,
        courseRunId,
        lessonDate,
        lessonType: 'base',
      },
    },
    select: { id: true, attended: true, source: true },
  });

  if (existing) {
    if (existing.source === 'manual') return 'manual_mark_kept';
    if (existing.attended) return 'already_marked';
    await prisma.classAttendance.update({
      where: { id: existing.id },
      data: { attended: true, status: 'keldi', source: 'qr', markedByUserId: scannedByUserId, updatedAt: new Date() },
    });
    return 'marked';
  }

  await prisma.classAttendance.create({
    data: {
      tenantId,
      customerId,
      courseRunId,
      lessonDate,
      lessonType: 'base',
      attended: true,
      status: 'keldi',
      source: 'qr',
      markedByUserId: scannedByUserId,
    },
  });
  return 'marked';
}

export async function checkInByTicketToken(
  tenantId: string,
  rawToken: string,
  scannedByUserId: string,
): Promise<QrCheckInResult> {
  const tokenHash = hashToken(rawToken.trim());
  const ticket = await prisma.attendanceTicket.findFirst({
    where: { tenantId, tokenHash, revokedAt: null },
    select: {
      customerId: true,
      courseRunId: true,
      customer: { select: { name: true, customerNumber: true } },
      courseRun: {
        select: {
          startDate: true,
          endDate: true,
          baseLessons: true,
          courseId: true,
          course: { select: { category: true, name: true } },
        },
      },
    },
  });
  if (!ticket) {
    return { ok: false, status: 'invalid_ticket' };
  }

  const { startDate, endDate, baseLessons, course, courseId } = ticket.courseRun;
  const enrollment = await loadEnrollmentSummary(tenantId, ticket.customerId, courseId);
  // Every outcome below shows the same student card on the scanner screen, so the
  // operator can see who scanned even when the check-in itself is rejected.
  const studentInfo = {
    customerName: ticket.customer.name,
    customerNumber: ticket.customer.customerNumber,
    courseName: course.name,
    tariffName: enrollment.tariffName,
    agreementAmount: enrollment.agreementAmount,
    remainingDebt: enrollment.remainingDebt,
  };

  const today = startOfDayLocal(new Date());

  if (today.getTime() < startOfDayLocal(startDate).getTime() || today.getTime() > startOfDayLocal(endDate).getTime()) {
    return { ok: true, status: 'no_lesson', ...studentInfo };
  }
  if (!isClassDayForRun(today, course.category, startDate)) {
    return { ok: true, status: 'not_class_day', ...studentInfo };
  }
  const slotKeys = buildSlotDateKeys(startDate, endDate, baseLessons, course.category);
  const todayKey = toDateKeyLocal(today);
  if (!slotKeys.includes(todayKey)) {
    return { ok: true, status: 'no_lesson', ...studentInfo };
  }

  const markStatus = await markQrAttendance({
    tenantId,
    customerId: ticket.customerId,
    courseRunId: ticket.courseRunId,
    lessonDate: today,
    scannedByUserId,
  });

  await prisma.auditLog
    .create({
      data: {
        tenantId,
        action: 'qr_attendance',
        resource: 'class_attendance',
        resourceId: ticket.courseRunId,
        metadata: {
          status: markStatus,
          customerId: ticket.customerId,
          lessonDate: todayKey,
          scannedByUserId,
        },
      },
    })
    .catch(() => undefined);

  return { ok: true, status: markStatus, ...studentInfo, lessonDate: todayKey };
}

// ---------------------------------------------------------------------------
// Broadcast messaging
// ---------------------------------------------------------------------------

export async function sendBroadcastMessage(params: {
  text: string;
  attachment?: { buffer: Buffer; filename: string; mimeType: string } | null;
  recipients: Array<{ id: string; telegramChatId: string }>;
}): Promise<{ sent: number; failed: number; failedCustomerIds: string[] }> {
  let sent = 0;
  const failedCustomerIds: string[] = [];

  for (const recipient of params.recipients) {
    try {
      if (params.attachment) {
        const isImage = params.attachment.mimeType.startsWith('image/');
        if (isImage) {
          await sendClientPhoto(recipient.telegramChatId, params.attachment.buffer, params.text);
        } else {
          await sendClientDocument(
            recipient.telegramChatId,
            params.attachment.filename,
            params.attachment.buffer,
            params.text,
            params.attachment.mimeType,
          );
        }
      } else {
        await sendClientMessage(recipient.telegramChatId, params.text);
      }
      sent += 1;
    } catch (error) {
      failedCustomerIds.push(recipient.id);
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'client_bot_broadcast_send_failed',
          customerId: recipient.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    // Small delay between sends, matching the sequential-await approach the
    // report bot already relies on rather than a dedicated rate limiter.
    await new Promise((resolve) => setTimeout(resolve, 35));
  }

  return { sent, failed: failedCustomerIds.length, failedCustomerIds };
}
