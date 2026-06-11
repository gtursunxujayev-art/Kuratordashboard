import crypto from 'crypto';
import { prisma } from '@kuratordashboard/db';

/**
 * Face ID -> student class attendance ingestion.
 *
 * A student is a `Customer`. Employees live in `users` and are naturally ignored.
 * Marks created here are `source = 'system'`, `markedByUserId = null`.
 * Manual marks (source = 'manual') are authoritative and are never overwritten.
 */

// ---------------------------------------------------------------------------
// Supported payload field synonyms
// ---------------------------------------------------------------------------

const IN_SYNONYMS = new Set(['IN', 'CHECK_IN', 'CHECKIN', 'ENTER', 'ENTRY', 'ACCESS_GRANTED']);
const OUT_SYNONYMS = new Set(['OUT', 'CHECK_OUT', 'CHECKOUT', 'EXIT']);

const ACTION_FIELDS = ['action', 'event', 'event_type', 'type', 'direction', 'check_type'];
const USER_ID_PATHS = [
  'user.id', 'user.user_id', 'user.person_id',
  'person.id', 'person_id', 'employee_id', 'external_user_id',
];
const PHONE_PATHS = [
  'user.phone_number', 'user.phone', 'user.mobile',
  'person.phone', 'phone', 'mobile',
];
const DATE_FIELDS = ['local_date', 'date', 'event_date'];
const TIMESTAMP_FIELDS = ['timestamp', 'event_time', 'created_at', 'time'];
const BRANCH_FIELDS = ['branch_name', 'branch', 'device_name', 'location_name'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export type FaceIdMeta = {
  status: string;
  phone: string | null;
  externalUserId: string | null;
  customerId: string | null;
  courseRunId: string | null;
  lessonDate: string | null;
  branchName: string | null;
  reason: string | null;
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
  reason?: string;
  customerId?: string;
  courseRunId?: string;
  lessonDate?: string;
  candidateRunIds?: string[];
};

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function extractFirst(obj: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const val = getNestedValue(obj, path);
    if (val !== null && val !== undefined) {
      const str = String(val).trim();
      if (str.length > 0) return str;
    }
  }
  return null;
}

function normalizeAction(raw: string): 'IN' | 'OUT' | null {
  const upper = raw.trim().toUpperCase().replace(/[-\s]/g, '_');
  if (IN_SYNONYMS.has(upper)) return 'IN';
  if (OUT_SYNONYMS.has(upper)) return 'OUT';
  return null;
}

function timestampToLocalDate(ts: string): string | null {
  if (!ts) return null;
  let date: Date;
  const num = Number(ts);
  if (!Number.isNaN(num) && num > 0) {
    // Unix timestamp: treat as seconds if < 1e10, milliseconds otherwise
    date = new Date(num < 1e10 ? num * 1000 : num);
  } else {
    date = new Date(ts);
  }
  if (Number.isNaN(date.getTime())) return null;

  const tz = process.env.REPORT_TIMEZONE || 'Asia/Tashkent';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Payload parsing — tolerates many real-world Face ID device formats
// ---------------------------------------------------------------------------

export function parseFaceIdPayload(body: unknown): ParsedFaceIdEvent | null {
  if (!body || typeof body !== 'object') return null;

  const root = body as Record<string, unknown>;

  // Unwrap common wrapper keys: { request: {...} }, { data: {...} }, { body: {...} }
  let payload = root;
  for (const wrapper of ['request', 'data', 'body']) {
    const wrapped = root[wrapper];
    if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
      payload = wrapped as Record<string, unknown>;
      break;
    }
  }

  // Normalize action from any recognized field
  let action: 'IN' | 'OUT' | null = null;
  for (const field of ACTION_FIELDS) {
    const raw = payload[field];
    if (raw !== null && raw !== undefined && String(raw).trim().length > 0) {
      const normalized = normalizeAction(String(raw));
      if (normalized) {
        action = normalized;
        break;
      }
    }
  }
  if (!action) return null;

  // User external ID
  const externalUserIdRaw = extractFirst(payload, USER_ID_PATHS);
  const externalUserId = externalUserIdRaw ? String(externalUserIdRaw).trim() : null;

  // Phone
  const rawPhone = extractFirst(payload, PHONE_PATHS);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  // Local date — explicit field first, then derive from timestamp in Tashkent tz
  let localDate = extractFirst(payload, DATE_FIELDS);
  if (!localDate) {
    const ts = extractFirst(payload, TIMESTAMP_FIELDS);
    if (ts) localDate = timestampToLocalDate(ts);
  }

  // Event type label (human-readable; used for WebhookEvent.eventType)
  const eventType = extractFirst(payload, ['event_type', 'type', 'action']) ?? 'check_in_out';

  // Branch / device / location
  const branchName = extractFirst(payload, BRANCH_FIELDS);

  // Name fields (best-effort)
  const firstName = asString(
    getNestedValue(payload, 'user.first_name') ?? getNestedValue(payload, 'person.first_name'),
  );
  const lastName = asString(
    getNestedValue(payload, 'user.last_name') ?? getNestedValue(payload, 'person.last_name'),
  );

  return {
    action,
    eventType,
    externalUserId: externalUserId || null,
    phone: phone && phone.length >= 7 ? phone : null,
    firstName,
    lastName,
    localDate,
    branchName,
    source: asString(payload.source) ?? 'FACE_ID',
    rawPayload: payload,
  };
}

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

function buildSlotDateKeys(startDate: Date, endDate: Date, targetCount: number): string[] {
  const start = startOfDayLocal(startDate);
  const end = startOfDayLocal(endDate);
  const classDays: string[] = [];
  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor = addDaysLocal(cursor, 1)
  ) {
    if (isClassDay(cursor)) {
      classDays.push(toDateKeyLocal(cursor));
    }
  }
  return classDays.slice(0, Math.max(0, targetCount));
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

  // 2) Phone match. Compare on the last 9 digits then confirm a full normalized match.
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
          .catch(() => undefined);
      }
      return { id: found.id, tenantId: found.tenantId, faceIdExternalId: found.faceIdExternalId };
    }

    if (exact.length > 1) {
      console.log(
        JSON.stringify({
          level: 'warn',
          event: 'faceid_student_ambiguous',
          reason: 'multiple_phone_matches',
          phoneMasked: `***${parsed.phone.slice(-4)}`,
          matchCount: exact.length,
        }),
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Lesson resolution
// ---------------------------------------------------------------------------

type LessonResolution =
  | { status: 'ok'; courseRunId: string; lessonDate: Date; candidateRunIds: string[] }
  | { status: 'no_lesson' };

async function resolveLesson(
  tenantId: string,
  customerId: string,
  eventDate: Date,
): Promise<LessonResolution> {
  const dayStart = startOfDayLocal(eventDate);
  const dayEnd = addDaysLocal(dayStart, 1);
  const dateKey = toDateKeyLocal(dayStart);

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
// WebhookEvent helpers
// ---------------------------------------------------------------------------

function buildIdempotencyKey(tenantId: string, rawBody: string): string {
  return crypto.createHash('sha256').update(`faceid:${tenantId}:${rawBody}`).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return String((error as any)?.code || '').toUpperCase() === 'P2002';
}

function buildMeta(
  parsed: ParsedFaceIdEvent,
  result: FaceIdWebhookResult,
): FaceIdMeta {
  return {
    status: result.status,
    phone: parsed.phone,
    externalUserId: parsed.externalUserId,
    customerId: result.customerId ?? null,
    courseRunId: result.courseRunId ?? null,
    lessonDate: result.lessonDate ?? null,
    branchName: parsed.branchName,
    reason: result.status === 'marked' ? null : (result.reason ?? result.status),
  };
}

// ---------------------------------------------------------------------------
// Public: extract _faceid_meta from a stored rawPayload (used by tRPC router)
// ---------------------------------------------------------------------------

export function extractFaceIdMetaFromPayload(rawPayload: unknown): Partial<FaceIdMeta> {
  if (!rawPayload || typeof rawPayload !== 'object') return {};
  const meta = (rawPayload as Record<string, unknown>)['_faceid_meta'];
  if (!meta || typeof meta !== 'object') return {};
  return meta as Partial<FaceIdMeta>;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

async function resolveFaceIdTenantId(): Promise<string | null> {
  const envTenant = process.env.FACEID_TENANT_ID?.trim();
  if (envTenant) return envTenant;
  const tenants = await prisma.tenant.findMany({ select: { id: true }, take: 2 });
  return tenants.length === 1 ? tenants[0].id : null;
}

export async function handleFaceIdWebhook(body: unknown): Promise<FaceIdWebhookResult> {
  // 1. Parse & validate payload structure
  const parsed = parseFaceIdPayload(body);
  if (!parsed) {
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'faceid_webhook',
        status: 'invalid_payload',
        reason: 'parse_failed',
        bodyType: typeof body,
      }),
    );
    return { ok: true, status: 'invalid_payload' };
  }

  // Log parsed summary — no identifiers, no secrets
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'faceid_webhook',
      status: 'parsed',
      action: parsed.action,
      eventType: parsed.eventType,
      hasPhone: !!parsed.phone,
      hasExternalId: !!parsed.externalUserId,
      localDate: parsed.localDate,
      branchName: parsed.branchName,
      dateSource: parsed.localDate ? 'explicit' : 'derived_from_timestamp',
    }),
  );

  // 2. Only IN events mark attendance; OUT events are explicitly ignored
  if (parsed.action !== 'IN') {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'faceid_webhook',
        status: 'ignored_action',
        action: parsed.action,
        branchName: parsed.branchName,
      }),
    );
    return { ok: true, status: 'ignored_action' };
  }

  const rawBody = JSON.stringify(body ?? {});
  const tenantScopeId = process.env.FACEID_TENANT_ID?.trim() || null;
  const earlyTenantId = await resolveFaceIdTenantId();

  // 3. Create WebhookEvent before student match (single-tenant path).
  //    This ensures every IN event is visible on the Face ID page, including unmatched scans.
  let webhookEventId: string | null = null;
  let eventTenantId: string | null = null;

  if (earlyTenantId) {
    const idempotencyKey = buildIdempotencyKey(earlyTenantId, rawBody);
    const initialMeta: FaceIdMeta = {
      status: 'processing',
      phone: parsed.phone,
      externalUserId: parsed.externalUserId,
      customerId: null,
      courseRunId: null,
      lessonDate: null,
      branchName: parsed.branchName,
      reason: null,
    };
    try {
      const ev = await prisma.webhookEvent.create({
        data: {
          tenantId: earlyTenantId,
          source: 'faceid_student',
          eventType: parsed.eventType,
          idempotencyKey,
          rawPayload: { ...parsed.rawPayload, _faceid_meta: initialMeta } as object,
          processed: false,
        },
        select: { id: true },
      });
      webhookEventId = ev.id;
      eventTenantId = earlyTenantId;
    } catch (error) {
      if (isUniqueViolation(error)) {
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'faceid_webhook',
            status: 'duplicate',
            idempotencyKey: idempotencyKey.slice(0, 8) + '...',
          }),
        );
        return { ok: true, status: 'duplicate' };
      }
      throw error;
    }
  }

  // Finalize WebhookEvent with the processing result (best-effort)
  const finalizeEvent = async (result: FaceIdWebhookResult, tenantId: string): Promise<void> => {
    if (!webhookEventId) return;
    await prisma.webhookEvent
      .update({
        where: { id: webhookEventId },
        data: {
          ...(tenantId !== eventTenantId ? { tenantId } : {}),
          processed: true,
          processedAt: new Date(),
          rawPayload: { ...parsed.rawPayload, _faceid_meta: buildMeta(parsed, result) } as object,
        },
      })
      .catch(() => undefined);
  };

  // 4. Match student
  const student = await matchStudent(parsed, tenantScopeId);
  if (!student) {
    const reason = parsed.phone
      ? 'no_customer_with_matching_phone'
      : parsed.externalUserId
        ? 'no_customer_with_matching_external_id'
        : 'no_identifier_provided';
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'faceid_webhook',
        status: 'student_not_found',
        reason,
        hasPhone: !!parsed.phone,
        hasExternalId: !!parsed.externalUserId,
        branchName: parsed.branchName,
      }),
    );
    const result: FaceIdWebhookResult = { ok: true, status: 'student_not_found', reason };
    if (webhookEventId && eventTenantId) {
      await finalizeEvent(result, eventTenantId);
    }
    return result;
  }

  const tenantId = student.tenantId;

  // Multi-tenant fallback: create event now using the matched student's tenantId
  if (!webhookEventId) {
    const idempotencyKey = buildIdempotencyKey(tenantId, rawBody);
    const initialMeta: FaceIdMeta = {
      status: 'processing',
      phone: parsed.phone,
      externalUserId: parsed.externalUserId,
      customerId: student.id,
      courseRunId: null,
      lessonDate: null,
      branchName: parsed.branchName,
      reason: null,
    };
    try {
      const ev = await prisma.webhookEvent.create({
        data: {
          tenantId,
          source: 'faceid_student',
          eventType: parsed.eventType,
          idempotencyKey,
          rawPayload: { ...parsed.rawPayload, _faceid_meta: initialMeta } as object,
          processed: false,
        },
        select: { id: true },
      });
      webhookEventId = ev.id;
      eventTenantId = tenantId;
    } catch (error) {
      if (isUniqueViolation(error)) {
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'faceid_webhook',
            status: 'duplicate',
            customerId: student.id,
            idempotencyKey: buildIdempotencyKey(tenantId, rawBody).slice(0, 8) + '...',
          }),
        );
        return { ok: true, status: 'duplicate', customerId: student.id };
      }
      throw error;
    }
  }

  // 5. Validate date
  if (!parsed.localDate) {
    const result: FaceIdWebhookResult = { ok: true, status: 'invalid_payload', customerId: student.id };
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'faceid_webhook',
        status: 'invalid_payload',
        reason: 'missing_local_date',
        customerId: student.id,
      }),
    );
    await finalizeEvent(result, tenantId);
    return result;
  }

  const eventDate = parseLocalDateKey(parsed.localDate);
  if (!eventDate) {
    const result: FaceIdWebhookResult = { ok: true, status: 'invalid_payload', customerId: student.id };
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'faceid_webhook',
        status: 'invalid_payload',
        reason: 'unparseable_date',
        localDate: parsed.localDate,
        customerId: student.id,
      }),
    );
    await finalizeEvent(result, tenantId);
    return result;
  }

  if (!isClassDay(eventDate)) {
    const result: FaceIdWebhookResult = { ok: true, status: 'not_class_day', customerId: student.id };
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'faceid_webhook',
        status: 'not_class_day',
        localDate: parsed.localDate,
        weekday: eventDate.getDay(),
        customerId: student.id,
      }),
    );
    await finalizeEvent(result, tenantId);
    return result;
  }

  // 6. Resolve lesson
  const lesson = await resolveLesson(tenantId, student.id, eventDate);
  if (lesson.status === 'no_lesson') {
    const result: FaceIdWebhookResult = { ok: true, status: 'no_lesson', customerId: student.id };
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'faceid_webhook',
        status: 'no_lesson',
        reason: 'no_active_course_run_with_base_lesson_on_date',
        localDate: parsed.localDate,
        customerId: student.id,
      }),
    );
    await finalizeEvent(result, tenantId);
    return result;
  }

  // 7. Mark attendance
  const markStatus = await markAttendance({
    tenantId,
    customerId: student.id,
    courseRunId: lesson.courseRunId,
    lessonDate: lesson.lessonDate,
  });

  const result: FaceIdWebhookResult = {
    ok: true,
    status: markStatus,
    customerId: student.id,
    courseRunId: lesson.courseRunId,
    lessonDate: toDateKeyLocal(lesson.lessonDate),
    candidateRunIds: lesson.candidateRunIds,
  };

  console.log(
    JSON.stringify({
      level: markStatus === 'marked' ? 'info' : 'debug',
      event: 'faceid_webhook',
      status: markStatus,
      customerId: student.id,
      courseRunId: lesson.courseRunId,
      lessonDate: toDateKeyLocal(lesson.lessonDate),
      branchName: parsed.branchName,
      candidateRunCount: lesson.candidateRunIds.length,
    }),
  );

  // 8. Finalize WebhookEvent + audit log
  await finalizeEvent(result, tenantId);

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
