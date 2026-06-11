# Face ID Student Attendance Integration

This document describes how Face ID access control devices are integrated with the Kuratordashboard student attendance system.

---

## Overview

When a student presents their face at a device, the device (or a middleware forwarder) sends a webhook `POST` to this API. The API:

1. Validates the secret token
2. Parses the payload (supports many field-naming conventions)
3. Matches the student by phone number or device user ID
4. Resolves which `CourseRun` lesson falls on that date
5. Marks `ClassAttendance.attended = true` with `source = 'system'`
6. Returns a structured JSON result and stores an audit record

Manual attendance marks (`source = 'manual'`) are **never** overwritten.

---

## Endpoint

```
POST /webhooks/faceid
```

| Detail | Value |
|---|---|
| Method | POST |
| Content-Type | application/json |
| Auth | Bearer token (see below) |

### Health check (no auth required)

```
GET /webhooks/faceid
```

Returns `{"ok":true,"endpoint":"/webhooks/faceid","method":"POST",...}`.

---

## Authentication

The token is checked via **constant-time comparison** to prevent timing attacks.
It can be provided in any of these ways (highest priority first):

| Method | Example |
|---|---|
| `Authorization: Bearer <token>` header | `Authorization: Bearer mysecret` |
| `?token=<token>` query param | `/webhooks/faceid?token=mysecret` |
| `?webhook_token=<token>` query param | `/webhooks/faceid?webhook_token=mysecret` |
| `?access_token=<token>` query param | `/webhooks/faceid?access_token=mysecret` |
| `body.token` JSON field | `{"token":"mysecret", "action":"IN", ...}` |

---

## Environment Variables

```bash
# Required
FACEID_WEBHOOK_SECRET=your-long-random-secret-here

# Optional — restricts student lookup to a single tenant (UUID)
# Leave empty if the system has only one tenant
FACEID_TENANT_ID=

# Timezone for deriving local date from timestamps (default: Asia/Tashkent)
REPORT_TIMEZONE=Asia/Tashkent
```

---

## Supported Payload Formats

The parser is intentionally permissive. All field names below are recognized.

### Action field names

Any of these fields will be read for the check-in/check-out direction:

| Field name | Recognized values for IN | Recognized values for OUT |
|---|---|---|
| `action` | `IN`, `in`, `check_in`, `checkin`, `enter`, `entry`, `access_granted` | `OUT`, `out`, `check_out`, `checkout`, `exit` |
| `event` | same as above | same |
| `event_type` | same | same |
| `type` | same | same |
| `direction` | same | same |
| `check_type` | same | same |

### User identifier field names

Checked in priority order:

1. `user.id`
2. `user.user_id`
3. `user.person_id`
4. `person.id`
5. `person_id`
6. `employee_id`
7. `external_user_id`

### Phone field names

Checked in priority order:

1. `user.phone_number`
2. `user.phone`
3. `user.mobile`
4. `person.phone`
5. `phone`
6. `mobile`

### Date field names

Checked in priority order:

1. `local_date` — preferred, format `YYYY-MM-DD`
2. `date`
3. `event_date`

If none found, falls back to timestamp fields:

4. `timestamp` — Unix seconds or milliseconds, or ISO 8601 string
5. `event_time`
6. `created_at`
7. `time`

Timestamps are converted to `YYYY-MM-DD` in the `REPORT_TIMEZONE` timezone (default `Asia/Tashkent`).

### Branch / device / location

First non-empty value among: `branch_name`, `branch`, `device_name`, `location_name`.

### Payload wrapping

Some devices wrap the payload under a top-level key. Recognized wrappers:

- `{ "request": { ...actual payload... } }`
- `{ "data": { ...actual payload... } }`
- `{ "body": { ...actual payload... } }`

---

## Payload Examples

### 1. Standard IN (most common format)

```json
{
  "action": "IN",
  "user": {
    "id": "ext-001",
    "phone_number": "998901234567",
    "first_name": "Ali",
    "last_name": "Valiyev"
  },
  "local_date": "2026-06-14",
  "branch_name": "Toshkent filiali"
}
```

### 2. OUT event (ignored, returns `ignored_action`)

```json
{
  "action": "OUT",
  "user": { "id": "ext-001", "phone_number": "998901234567" },
  "local_date": "2026-06-14"
}
```

### 3. Wrapped under `request`

```json
{
  "request": {
    "action": "IN",
    "user": { "id": "ext-002", "phone_number": "998907654321" },
    "local_date": "2026-06-14",
    "branch_name": "Samarqand filiali"
  }
}
```

### 4. Alternative field names

```json
{
  "event_type": "check_in",
  "person": { "id": "ext-003", "phone": "998911112222" },
  "event_date": "2026-06-14",
  "location_name": "Chilonzor"
}
```

### 5. Missing phone, known external ID

```json
{
  "action": "IN",
  "external_user_id": "ext-004",
  "local_date": "2026-06-14"
}
```

The student must have been matched via phone at least once before so that their
`faceIdExternalId` was learned and stored in the database.

### 6. Timestamp instead of local_date

```json
{
  "action": "access_granted",
  "employee_id": "ext-005",
  "phone": "998903334455",
  "timestamp": "1750000000",
  "device_name": "Main Gate"
}
```

The `timestamp` (Unix seconds) is converted to `YYYY-MM-DD` in `Asia/Tashkent`.

### 7. Wrapped under `data`, `direction` action

```json
{
  "data": {
    "direction": "enter",
    "user": { "user_id": "ext-007", "mobile": "998906667788" },
    "event_date": "2026-06-14",
    "branch": "Yunusobod"
  }
}
```

---

## curl Test Commands

Replace `<BASE_URL>` with your API base URL (e.g., `https://api.example.com` or `http://localhost:3001`).
Replace `<TOKEN>` with `FACEID_WEBHOOK_SECRET` value.

### Health check

```bash
curl -s "<BASE_URL>/webhooks/faceid" | jq .
```

### Valid IN event

```bash
curl -s -X POST "<BASE_URL>/webhooks/faceid" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "IN",
    "user": { "id": "ext-001", "phone_number": "998901234567" },
    "local_date": "2026-06-14",
    "branch_name": "Toshkent filiali"
  }' | jq .
```

### OUT event (should return `ignored_action`)

```bash
curl -s -X POST "<BASE_URL>/webhooks/faceid" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action":"OUT","user":{"id":"ext-001","phone_number":"998901234567"},"local_date":"2026-06-14"}' | jq .
```

### Invalid token (should return 401)

```bash
curl -s -X POST "<BASE_URL>/webhooks/faceid" \
  -H "Authorization: Bearer WRONG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"IN","user":{"phone_number":"998901234567"},"local_date":"2026-06-14"}' | jq .
```

### Send same payload twice (second call should return `duplicate`)

```bash
PAYLOAD='{"action":"IN","user":{"id":"dup-test","phone_number":"998901234567"},"local_date":"2026-06-14"}'

curl -s -X POST "<BASE_URL>/webhooks/faceid" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq .

curl -s -X POST "<BASE_URL>/webhooks/faceid" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq .
```

### Token via query parameter

```bash
curl -s -X POST "<BASE_URL>/webhooks/faceid?token=<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action":"IN","user":{"phone_number":"998901234567"},"local_date":"2026-06-14"}' | jq .
```

---

## Expected Responses

All successful responses (even "nothing to do") return HTTP 200 with `{"ok":true,...}`.

| `status` | Meaning | HTTP |
|---|---|---|
| `marked` | Attendance marked for this lesson | 200 |
| `already_marked` | Face ID record already existed and was already true | 200 |
| `manual_mark_kept` | A manual mark exists — Face ID does not override it | 200 |
| `duplicate` | Identical payload was already processed (idempotent) | 200 |
| `ignored_action` | Action was OUT — ignored by design | 200 |
| `student_not_found` | No `Customer` with matching phone or external ID | 200 |
| `no_lesson` | Student has no `CourseRun` with a base lesson on this date | 200 |
| `not_class_day` | Date is not Saturday or Sunday | 200 |
| `invalid_payload` | Body could not be parsed or date is malformed | 200 |
| — | `FACEID_WEBHOOK_SECRET` not configured | 503 |
| — | Wrong or missing token | 401 |
| — | Unhandled exception | 500 |

### Example: `marked`

```json
{
  "ok": true,
  "status": "marked",
  "customerId": "a1b2c3d4-...",
  "courseRunId": "e5f6g7h8-...",
  "lessonDate": "2026-06-14",
  "candidateRunIds": ["e5f6g7h8-..."]
}
```

### Example: `student_not_found`

```json
{"ok": true, "status": "student_not_found"}
```

---

## Admin UI

Admins and Managers can view recent Face ID events at:

```
/faceid
```

The page shows:
- Status counters for the last 30 days
- Filterable table (by status, date range, phone, branch)
- Phone numbers are masked (last 4 digits only)

---

## Student Matching Logic

1. **External ID** — If the incoming payload has a user ID (any supported field), and a `Customer` already has `faceIdExternalId` matching it, that customer is used immediately.
2. **Phone** — The phone is normalized (digits only) and matched on the last 9 digits against all customers. If **exactly one** customer matches, it is used and the external ID is stored for future fast lookup (`faceIdExternalId` auto-learned).
3. **Ambiguous phone** — If 2+ customers share the same phone suffix, the webhook is rejected (`student_not_found`) to avoid misattribution.

---

## Lesson Resolution Logic

1. Find all `CourseRun` records the student is a member of (`CourseRunMember`) whose date window covers the event date.
2. From those runs, compute the base lesson dates (`buildSlotDateKeys`) and check if the event date is one of them.
3. If multiple qualifying runs exist, the one with the most recent `startDate` wins (deterministic tie-break).
4. Only `base` lesson slots are considered. `premium_extra` lessons are curriculum-driven and not marked via Face ID.

---

## Idempotency

Each webhook payload is hashed with `SHA-256` (keyed by tenant + raw JSON body). The hash is stored as `WebhookEvent.idempotencyKey`. A unique constraint on `(tenantId, source, idempotencyKey)` prevents double-processing identical payloads.

---

## Audit Trail

Every payload that reaches a known student produces a `WebhookEvent` record (in `webhook_events` table) with:
- `source = 'faceid'`
- `rawPayload` containing `_faceid_meta` with the processing result
- `processedAt` timestamp

Additionally, for attendance outcomes (`marked`, `already_marked`, `manual_mark_kept`), an `AuditLog` record is created with `action = 'faceid_attendance'`.

---

## Deployment Notes

1. Set `FACEID_WEBHOOK_SECRET` to a long random string (minimum 32 characters recommended).
2. Set `FACEID_TENANT_ID` to your tenant UUID if your system has multiple tenants and Face ID should only match students from one of them. Leave empty for single-tenant deployments.
3. Set `REPORT_TIMEZONE=Asia/Tashkent` (already the default).
4. The webhook endpoint must be publicly reachable from the Face ID device/forwarder.
5. If using a reverse proxy (nginx, Caddy), ensure the `Authorization` header and `Content-Type: application/json` are forwarded.
6. The endpoint accepts payloads up to 10 MB (Express limit), which is far more than any Face ID payload needs.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| HTTP 401 | Wrong or missing token | Check `FACEID_WEBHOOK_SECRET` and how the token is sent |
| HTTP 503 | `FACEID_WEBHOOK_SECRET` not set | Set the env variable and restart |
| `student_not_found` | Phone not in Customer table | Add phone to the student's Customer record |
| `student_not_found` | Ambiguous phone (2+ matches) | Deduplicate phone numbers in the Customer table |
| `no_lesson` | Student not in a `CourseRunMember` | Add student to the course run roster |
| `no_lesson` | Date outside course run window | Check `CourseRun.startDate` and `endDate` |
| `not_class_day` | Event on a weekday | Face ID only marks Saturday/Sunday lessons |
| `invalid_payload` | `local_date` missing, no timestamp | Ensure device sends date or timestamp |
| `duplicate` on every call | Device resends the exact same body | Each unique event body is processed only once (by design) |
| `manual_mark_kept` | Kurator already marked this lesson manually | Face ID intentionally does not override manual marks |
| Date is off by one day | Timestamp in wrong timezone | Set `REPORT_TIMEZONE` to match the device's clock timezone |

---

## Running Parse Tests

```bash
npx tsx apps/api/src/services/attendance/__tests__/faceid.examples.ts
```

This runs payload parsing tests (no database required).
