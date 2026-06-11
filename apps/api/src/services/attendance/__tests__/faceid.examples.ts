/**
 * Face ID payload examples and expected parse results.
 *
 * These examples document the supported payload formats and can be used:
 *  - as curl request bodies (see FACEID_INTEGRATION.md)
 *  - as inputs to parseFaceIdPayload() for manual testing
 *  - as seeds for an integration test suite if one is added
 *
 * Run standalone:
 *   npx tsx apps/api/src/services/attendance/__tests__/faceid.examples.ts
 */

import { parseFaceIdPayload, type FaceIdWebhookResult } from '../faceid';

// ---------------------------------------------------------------------------
// Payload examples
// ---------------------------------------------------------------------------

export const payloads = {
  /** Standard IN payload from most Face ID devices */
  validIn: {
    action: 'IN',
    user: { id: 'ext-001', phone_number: '998901234567', first_name: 'Ali', last_name: 'Valiyev' },
    local_date: '2026-06-14',
    branch_name: 'Toshkent filiali',
  },

  /** Standard OUT payload — should be ignored */
  validOut: {
    action: 'OUT',
    user: { id: 'ext-001', phone_number: '998901234567' },
    local_date: '2026-06-14',
    branch_name: 'Toshkent filiali',
  },

  /** Payload wrapped under a `request` key (some devices/forwarders add this) */
  wrappedUnderRequest: {
    request: {
      action: 'IN',
      user: { id: 'ext-002', phone_number: '998907654321' },
      local_date: '2026-06-14',
      branch_name: 'Samarqand filiali',
    },
  },

  /** Alternative field names: event_type + person + mobile */
  alternativeFieldNames: {
    event_type: 'check_in',
    person: { id: 'ext-003', phone: '998911112222' },
    local_date: '2026-06-14',
    location_name: 'Chilonzor',
  },

  /** No phone, but known externalUserId — should match via faceIdExternalId */
  knownExternalIdNoPhone: {
    action: 'IN',
    external_user_id: 'ext-004',
    local_date: '2026-06-14',
  },

  /** Unknown student — phone doesn't match any Customer */
  unknownStudent: {
    action: 'IN',
    user: { id: 'ext-999', phone_number: '998999999999' },
    local_date: '2026-06-14',
  },

  /** Non-class day (Wednesday = 3) — should return not_class_day */
  nonClassDay: {
    action: 'IN',
    user: { id: 'ext-001', phone_number: '998901234567' },
    local_date: '2026-06-11', // Thursday
  },

  /** Duplicate — identical body sent twice; second should return duplicate */
  duplicate: {
    action: 'IN',
    user: { id: 'ext-001', phone_number: '998901234567' },
    local_date: '2026-06-14',
    branch_name: 'Toshkent filiali',
  },

  /** Missing local_date but has a Unix timestamp — should derive date in Asia/Tashkent */
  timestampInsteadOfDate: {
    action: 'IN',
    user: { id: 'ext-005', phone_number: '998903334455' },
    timestamp: '1750000000',  // Unix seconds; resolves to a specific local date
    branch_name: 'Online',
  },

  /** access_granted action synonym */
  accessGrantedAction: {
    action: 'access_granted',
    employee_id: 'ext-006',
    phone: '998905556677',
    local_date: '2026-06-14',
    device_name: 'Main Gate',
  },

  /** Payload wrapped under `data` key */
  wrappedUnderData: {
    data: {
      direction: 'enter',
      user: { user_id: 'ext-007', mobile: '998906667788' },
      event_date: '2026-06-14',
      branch: 'Yunusobod',
    },
  },
};

// ---------------------------------------------------------------------------
// Expected parse results for each payload
// ---------------------------------------------------------------------------

type ExpectedParse = {
  action: 'IN' | 'OUT' | null;  // null = parseFaceIdPayload should return null
  phone: string | null;
  externalUserId: string | null;
  localDate: string | null;
};

export const expectedParseResults: Record<keyof typeof payloads, ExpectedParse> = {
  validIn:                { action: 'IN',  phone: '998901234567', externalUserId: 'ext-001', localDate: '2026-06-14' },
  validOut:               { action: 'OUT', phone: '998901234567', externalUserId: 'ext-001', localDate: '2026-06-14' },
  wrappedUnderRequest:    { action: 'IN',  phone: '998907654321', externalUserId: 'ext-002', localDate: '2026-06-14' },
  alternativeFieldNames:  { action: 'IN',  phone: '998911112222', externalUserId: 'ext-003', localDate: '2026-06-14' },
  knownExternalIdNoPhone: { action: 'IN',  phone: null,           externalUserId: 'ext-004', localDate: '2026-06-14' },
  unknownStudent:         { action: 'IN',  phone: '998999999999', externalUserId: 'ext-999', localDate: '2026-06-14' },
  nonClassDay:            { action: 'IN',  phone: '998901234567', externalUserId: 'ext-001', localDate: '2026-06-11' },
  duplicate:              { action: 'IN',  phone: '998901234567', externalUserId: 'ext-001', localDate: '2026-06-14' },
  timestampInsteadOfDate: { action: 'IN',  phone: '998903334455', externalUserId: 'ext-005', localDate: null /* actual date depends on env */ },
  accessGrantedAction:    { action: 'IN',  phone: '998905556677', externalUserId: 'ext-006', localDate: '2026-06-14' },
  wrappedUnderData:       { action: 'IN',  phone: '998906667788', externalUserId: 'ext-007', localDate: '2026-06-14' },
};

// ---------------------------------------------------------------------------
// Expected handleFaceIdWebhook results (integration — requires DB)
// ---------------------------------------------------------------------------

export const expectedWebhookResults: Partial<Record<keyof typeof payloads, Partial<FaceIdWebhookResult>>> = {
  validIn:                { ok: true, status: 'marked' },          // assuming known student, class day, lesson exists
  validOut:               { ok: true, status: 'ignored_action' },
  unknownStudent:         { ok: true, status: 'student_not_found' },
  nonClassDay:            { ok: true, status: 'not_class_day' },
  duplicate:              { ok: true, status: 'duplicate' },        // second call with same body
};

// ---------------------------------------------------------------------------
// Self-test runner (parse only, no DB)
// ---------------------------------------------------------------------------

function runParseTests(): void {
  let passed = 0;
  let failed = 0;

  for (const [name, body] of Object.entries(payloads)) {
    const expected = expectedParseResults[name as keyof typeof payloads];
    const result = parseFaceIdPayload(body);

    const actualAction = result?.action ?? null;
    const actualPhone = result?.phone ?? null;
    const actualExternalId = result?.externalUserId ?? null;
    const actualDate = result?.localDate ?? null;

    const actionOk = actualAction === expected.action;
    const phoneOk = actualPhone === expected.phone;
    const externalIdOk = actualExternalId === expected.externalUserId;

    // For timestampInsteadOfDate the date is runtime-dependent; skip exact check
    const dateOk = name === 'timestampInsteadOfDate'
      ? (result !== null && result.localDate !== null)
      : actualDate === expected.localDate;

    if (actionOk && phoneOk && externalIdOk && dateOk) {
      console.log(`  PASS  ${name}`);
      passed++;
    } else {
      console.error(`  FAIL  ${name}`);
      if (!actionOk) console.error(`         action: expected=${expected.action}, got=${actualAction}`);
      if (!phoneOk) console.error(`         phone:  expected=${expected.phone}, got=${actualPhone}`);
      if (!externalIdOk) console.error(`         extId:  expected=${expected.externalUserId}, got=${actualExternalId}`);
      if (!dateOk) console.error(`         date:   expected=${expected.localDate}, got=${actualDate}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// Run when executed directly
const isMain = process.argv[1]?.includes('faceid.examples');
if (isMain) {
  console.log('Running Face ID payload parse tests...\n');
  runParseTests();
}
