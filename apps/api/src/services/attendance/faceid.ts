import crypto from 'crypto';
import { prisma } from '@kuratordashboard/db';

/**
 * Face ID -> student class attendance ingestion.
 *
 * Differs from Dashboarduz (which tracks EMPLOYEE work-time on the `users` table):
 *  - A student is a `Customer` (no role column). Anyone matched in `customers` is a student;
 *    employees live in `users` and are therefore naturally ignored.
 *  - Attendance is per-lesson (`ClassAttendance`): a specific class date (Sat/Sun) inside a
 *    `CourseRun` the student belongs to. We mark `attended = true` for that lesson.
 *  - Marks created here are `source = 'system'`, `markedByUserId = null`.
 *  - Manual marks (source = 'manual') are authoritative and are never overwritten.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FaceIdUser = {
  id?: string | number | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  role?: string | null;
};

export type FaceIdPayload = {
  event_type?: string | null;
  action?: string | null;
  user?: FaceIdUser | null;
  timestamp?: string | null;
  local_time?: string | null;
  local_date?: string | null;
  local_time_only?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  source?: string | null;
  branch_name?: string | null;
  late_minutes?: string | number | null;
};

type ParsedFaceIdEvent = {
  action: 'IN' | 'OUT';
  eventType: string;
  externalUserId: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  localDate: string | null; // YYYY-MM-DD
  branchName: string | null;
  source: string;
  rawPayload: Record<string, unknown>;
};

export type FaceIdWebhookResult = {
  ok: boolean;
  status:
    | 'marked'
    | 'already_marked'
    | 'manual_mark_kept'
    | 'duplicate'
    | 'student_not_found'
    | 'no_lesson'
    | 'not_class_day'
    | 'ignored_action'
    | 'invalid_payload';
  customerId?: string;
  courseRunId?: string;
  lessonDate?: string;
  candidateRunIds?: string[];
};

// ---------------------------------------------------------------------------
// Date helpers (mirrors apps/api/src/trpc/routers/amaliy.ts)
// ---------------------------------------------------------------------------

function startOfDayLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDaysLocal(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isClassDay(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

function parseLocalDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** First `targetCount` class days (Sat/Sun) between start and end inclusive. */
function buildSlotDateKeys(startDate: Date, endDate: Date, targetCount: number): string[] {
  const start = startOfDayLocal(startDate);
  const end = startOfDayLocal(endDate);
  const classDays: string[] = [];
  for (let cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor = addDaysLocal(cursor, 1)) {
    if (isClassDay(cursor)) {
      classDays.push(toDateKeyLocal(cursor));
    }
  }
  return classDays.slice(0, Math.max(0, targetCount));
}

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

export function parseFaceIdPayload(body: unknown): ParsedFaceIdEvent | null {
  if (!body || typeof body !== 'object') return null;
  // The device/forwarder may wrap the payload under `request`.
  const root = body as Record<string, unknown>;
  const payload = (root.request && typeof root.request === 'object'
    ? (root.request as Record<string, unknown>)
    : root) as FaceIdPayload;

  const actionRaw = String(payload.action ?? '').trim().toUpperCase();
  if (actionRaw !== 'IN' && actionRaw !== 'OUT') return null;

  const user = (payload.user ?? {}) as FaceIdUser;

  return {
    action: actionRaw,
    eventType: String(payload.event_type ?? 'check_in_out'),
    externalUserId: asString(user.id),
    phone: normalizePhone(user.phone_number) || null,
    firstName: asString(user.first_name),
    lastName: asString(user.last_name),
    localDate: asString(payload.local_date),
    branchName: asString(payload.branch_name),
    source: String(payload.source ?? 'FACE_ID'),
    rawPayload: payload as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Student matching (Customer = student; employees live in `users` and are ignored)
// ---------------------------------------------------------------------------

type MatchedStudent = { id: string; tenantId: string; faceIdExternalId: string | null };

async function matchStudent(
  parsed: ParsedFaceIdEvent,
  tenantScopeId: string | null,
): Promise<MatchedStudent | null> {
  const tenantWhere = tenantScopeId ? { tenantId: tenantScopeId } : {};

  // 1) Strongest signal: a previously learned Face ID external id.
  if (parsed.externalUserId) {
    const byExternal = await prisma.customer.findFirst({
      where: { ...tenantWhere, faceIdExternalId: parsed.externalUserId },
      select: { id: true, tenantId: true, faceIdExternalId: true },
    });
    if (byExternal) return byExternal;
  }

  // 2) Phone match. Compare on the last 9 digits then confirm a full normalized match,
  //    because stored phones may carry country codes / formatting.
  if (parsed.phone && parsed.phone.length >= 7) {
    const last9 = parsed.phone.slice(-9);
    const candidates = await prisma.customer.findMany({
      where: { ...tenantWhere, phone: { contains: last9 } },
      select: { id: true, tenantId: true, phone: true, faceIdExternalId: true },
      take: 25,
    });

    const exact = candidates.filter((c) => {
      const normalized = normalizePhone(c.phone);
      return normalized.length >= 7 && normalized.slice(-9) === last9;
    });

    if (exact.length === 1) {
      const found = exact[0];
      // Learn the device id for fast, robust future matches.
      if (parsed.externalUserId && !found.faceIdExternalId) {
        await prisma.customer
          .update({
            where: { id: found.id },
            data: { faceIdExternalId: parsed.externalUserId },
          })
          .catch(() => undefined); // best-effort; e.g. id already taken by another row
      }
      return { id: found.id, tenantId: found.tenantId, faceIdExternalId: found.faceIdExternalId };
    }
    // exact.length === 0 -> not a student (or no phone on file)
    // exact.length > 1   -> ambiguous phone; refuse to guess
  }

  return null;
}

// ---------------------------------------------------------------------------
// Lesson resolution
// ---------------------------------------------------------------------------

type LessonResolution =
  | { status: 'ok'; courseRunId: string; lessonDate: Date; candidateRunIds: string[] }
  | { status: 'no_lesson' };

/**
 * Find the active CourseRun (the student belongs to) that has a BASE lesson on `eventDate`.
 * Per product decision: when several active runs have a lesson that day, mark the one that
 * started most recently (latest startDate). This is deterministic and never refuses.
 * Face ID only marks `base` lessons (physical presence); `premium_extra` stays curriculum-driven/manual.
 */
async function resolveLesson(
  tenantId: string,
  customerId: string,
  eventDate: Date,
): Promise<LessonResolution> {
  const dayStart = startOfDayLocal(eventDate);
  const dayEnd = addDaysLocal(dayStart, 1);
  const dateKey = toDateKeyLocal(dayStart);

  // Runs the student is a member of whose [startDate, endDate] window covers this date.
  const memberships = await prisma.courseRunMember.findMany({
    where: {
      tenantId,
      customerId,
      courseRun: {
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
      },
    },
    select: {
      courseRun: {
        select: { id: true, startDate: true, endDate: true, baseLessons: true },
      },
    },
  });

  const qualifying: Array<{ id: string; startDate: Date }> = [];
  for (const membership of memberships) {
    const run = membership.courseRun;
    if (!run) continue;
    const baseSlots = buildSlotDateKeys(run.startDate, run.endDate, run.baseLessons);
    if (baseSlots.includes(dateKey)) {
      qualifying.push({ id: run.id, startDate: run.startDate });
    }
  }

  if (qualifying.length === 0) return { status: 'no_lesson' };

  // Tie-break: most recently started run wins.
  qualifying.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  return {
    status: 'ok',
    courseRunId: qualifying[0].id,
    lessonDate: dayStart,
    candidateRunIds: qualifying.map((q) => q.id),
  };
}

// ---------------------------------------------------------------------------
// Attendance upsert (respect manual marks)
// ---------------------------------------------------------------------------

async function markAttendance(params: {
  tenantId: string;
  customerId: string;
  courseRunId: string;
  lessonDate: Date;
}): Promise<'marked' | 'already_marked' | 'manual_mark_kept'> {
  const { tenantId, customerId, courseRunId, lessonDate } = params;

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
    // Never override a human decision.
    if (existing.source === 'manual') return 'manual_mark_kept';
    if (existing.attended) return 'already_marked';
    await prisma.classAttendance.update({
      where: { id: existing.id },
      data: { attended: true, source: 'system', markedByUserId: null, updatedAt: new Date() },
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
      source: 'system',
      markedByUserId: null,
    },
  });
  return 'marked';
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

function buildIdempotencyKey(tenantId: string, rawBody: string): string {
  return crypto.createHash('sha256').update(`faceid:${tenantId}:${rawBody}`).digest('hex');
}

/**
 * Process a single Face ID webhook body end-to-end:
 * parse -> match student -> resolve lesson -> idempotent record -> mark attendance.
 * Returns a structured, side-effect-free-on-error summary.
 */
export async function handleFaceIdWebhook(body: unknown): Promise<FaceIdWebhookResult> {
  const parsed = parseFaceIdPayload(body);
  if (!parsed) {
    return { ok: true, status: 'invalid_payload' };
  }

  // A single physical check-in is enough for a class; OUT events are not attendance signals.
  if (parsed.action !== 'IN') {
    return { ok: true, status: 'ignored_action' };
  }

  const tenantScopeId = process.env.FACEID_TENANT_ID?.trim() || null;

  const student = await matchStudent(parsed, tenantScopeId);
  if (!student) {
    return { ok: true, status: 'student_not_found' };
  }

  const tenantId = student.tenantId;

  if (!parsed.localDate) {
    return { ok: true, status: 'invalid_payload', customerId: student.id };
  }
  const eventDate = parseLocalDateKey(parsed.localDate);
  if (!eventDate) {
    return { ok: true, status: 'invalid_payload', customerId: student.id };
  }
  if (!isClassDay(eventDate)) {
    return { ok: true, status: 'not_class_day', customerId: student.id };
  }

  // Idempotency: a re-delivered identical payload must not double-process.
  const rawBody = JSON.stringify(body ?? {});
  const idempotencyKey = buildIdempotencyKey(tenantId, rawBody);
  try {
    await prisma.webhookEvent.create({
      data: {
        tenantId,
        source: 'faceid',
        eventType: parsed.eventType,
        idempotencyKey,
        rawPayload: parsed.rawPayload as object,
        processed: false,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: true, status: 'duplicate', customerId: student.id };
    }
    throw error;
  }

  const lesson = await resolveLesson(tenantId, student.id, eventDate);

  let result: FaceIdWebhookResult;
  if (lesson.status === 'no_lesson') {
    result = { ok: true, status: 'no_lesson', customerId: student.id };
  } else {
    const markStatus = await markAttendance({
      tenantId,
      customerId: student.id,
      courseRunId: lesson.courseRunId,
      lessonDate: lesson.lessonDate,
    });
    result = {
      ok: true,
      status: markStatus,
      customerId: student.id,
      courseRunId: lesson.courseRunId,
      lessonDate: toDateKeyLocal(lesson.lessonDate),
      // When >1, courseRunId is the most recently started run (tie-break).
      candidateRunIds: lesson.candidateRunIds,
    };
  }

  // Close out the webhook event + audit trail (best-effort).
  await prisma.webhookEvent
    .updateMany({
      where: { tenantId, source: 'faceid', idempotencyKey },
      data: { processed: true, processedAt: new Date() },
    })
    .catch(() => undefined);

  await prisma.auditLog
    .create({
      data: {
        tenantId,
        action: 'faceid_attendance',
        resource: 'class_attendance',
        resourceId: result.courseRunId ?? null,
        metadata: {
          status: result.status,
          customerId: result.customerId,
          lessonDate: result.lessonDate,
          branch: parsed.branchName,
          candidateRunIds: result.candidateRunIds,
        },
      },
    })
    .catch(() => undefined);

  return result;
}

// ---------------------------------------------------------------------------
// Prisma error helpers
// ---------------------------------------------------------------------------

function isUniqueViolation(error: unknown): boolean {
  const code = String((error as any)?.code || '').toUpperCase();
  return code === 'P2002';
}
