# Deployment Notes

## Required environment variables

### API (Railway)
- `DATABASE_URL`
- `JWT_SECRET` (required; API fails to start when missing)
- `JWT_EXPIRES_IN` (optional, default `7d`)
- `PORT`
- `NODE_ENV`
- `CORS_ORIGIN` (comma-separated if multiple)
- `TELEGRAM_BOT_TOKEN` (required for Telegram PDF reports)
- `TELEGRAM_WEBHOOK_SECRET` (required; must match Telegram webhook secret header)
- `TELEGRAM_BOT_USERNAME` (optional; used for deep-link shown in settings)
- `REPORT_CRON_SECRET` (required for `/internal/reports/telegram/run`)
- `REPORT_TIMEZONE` (optional, default `Asia/Tashkent`)
- `FACEID_WEBHOOK_SECRET` (required for Face ID attendance webhook)
- `FACEID_TENANT_ID` (optional; scopes Face ID matching to one tenant — omit for multi-tenant)
- `CLIENT_BOT_TOKEN` (required for the client-facing Telegram bot — separate from `TELEGRAM_BOT_TOKEN`)
- `CLIENT_BOT_WEBHOOK_SECRET` (required; must match the client bot's webhook secret header)
- `CLIENT_BOT_USERNAME` (optional; used to build the client deep-link `https://t.me/<username>?start=<token>`)
- `CLIENT_BOT_TENANT_ID` (optional; scopes client bot matching to one tenant — omit for multi-tenant)

## PDF renderer runtime notes

- Telegram report PDF renderer uses `puppeteer` (HTML -> PDF).
- Do **not** set `PUPPETEER_SKIP_DOWNLOAD=true` in API build environment.
- If your platform provides a custom Chrome binary, set `PUPPETEER_EXECUTABLE_PATH`.

### Web (Vercel)
- `NEXT_PUBLIC_API_URL`

## Shared-login requirement

If Kuratordashboard and Dashboarduz use the same database and shared credentials,
`JWT_SECRET` should be aligned with Dashboarduz.

## Security behavior

- Protected endpoints revalidate user `isActive` and current roles from DB on each request.
- Role changes and deactivations take effect immediately for existing bearer tokens.

## Deploy order

1. Database migration
2. API deployment
3. Web deployment
4. Configure Telegram webhooks (report bot + client bot) + Railway cron jobs
5. If correcting existing course runs for the Friday/Saturday cutover (see below),
   run `fix-offline-run-start-days.ts` in dry-run and review before `--apply`.

This order prevents UI/backend contract mismatch during rollout.

## Face ID student attendance webhook

- Endpoint: `POST /webhooks/faceid` (Railway API domain).
- Auth: `Authorization: Bearer <FACEID_WEBHOOK_SECRET>`, or `?token=`, or `body.token`.
- Only `action: "IN"` events mark attendance; `OUT` is ignored.
- Student = `Customer` row matched by `faceIdExternalId` (learned) or last-9-digit phone; employees in `users` are naturally ignored.
- Marks `ClassAttendance` with `attended=true`, `source='system'`, `markedByUserId=null` for the base lesson of the most recently started active `CourseRun` the student belongs to. The lesson-day pattern (Friday/Saturday vs Saturday/Sunday) is resolved per course run from its own `startDate` — see the Friday/Saturday cutover note below.
- Manual marks (`source='manual'`) are never overwritten.
- Idempotent: duplicate deliveries return `{ status: 'duplicate' }` via `WebhookEvent`.

## Telegram cron endpoints

- Webhook: `POST /webhooks/telegram` with `x-telegram-bot-api-secret-token`.
  - Important: webhook URL must point to API domain (Railway), not Web domain (Vercel).
- Scheduler: `POST /internal/reports/telegram/run`
  - Auth via `Authorization: Bearer <REPORT_CRON_SECRET>`
  - Body/query (admin/manager PDF): `audience=admin_manager&period=daily|weekly|monthly`
  - Body/query (curator text): `audience=curators&slot=noon|evening&period=daily`

## Client bot: linking, QR attendance, and messaging

- Fully separate Telegram bot from the staff report bot — create it via BotFather and
  set `CLIENT_BOT_TOKEN`/`CLIENT_BOT_WEBHOOK_SECRET`/`CLIENT_BOT_USERNAME`/`CLIENT_BOT_TENANT_ID`.
- Webhook: `POST /webhooks/client-bot` with `x-telegram-bot-api-secret-token` matching `CLIENT_BOT_WEBHOOK_SECRET`.
  Register it with Telegram's `setWebhook` API pointing at the Railway API domain.
- Linking: staff generate a per-client invite link from the student detail page
  (`clientBot.createLinkToken`, `https://t.me/<CLIENT_BOT_USERNAME>?start=<token>`, 30-minute TTL).
  If a client presses Start with no token, the bot asks them to share their phone number
  and matches it the same way FaceID does (last 9 digits against `customers.customerNumber`).
- QR ticket: one static ticket per `(customer, courseRun)`, generated and sent automatically
  right after a successful link (for any existing active offline/intensiv enrollment) or on
  demand via the "QR chipta yuborish" button on the student detail page.
- Check-in: a keyboard-wedge hardware scanner "types" the scanned ticket token + Enter into
  whatever page is open in the dashboard; a global listener catches it and calls
  `clientBot.checkInByTicket`, which marks `ClassAttendance` with `source='qr'` — distinct
  from FaceID's `source='system'` — and never overrides a `source='manual'` mark.
- Messaging: `/messages` page lets managers broadcast text + an optional image/file to all
  linked clients, filterable by course/tariff, via `messages.send`.

## Friday/Saturday offline schedule cutover

- Offline/intensiv class days moved from Saturday-Sunday to Friday-Saturday, effective for
  any `CourseRun` whose own `startDate` is on/after **2026-09-01**. The rule is evaluated
  per course run (see `apps/api/src/utils/course-schedule.ts`), not by the current date, so
  a run that started before the cutover keeps Saturday-Sunday for its whole duration.
- Course runs already created with a post-cutover `startDate` under the old Saturday-start
  assumption need correcting. Use `tsx apps/api/src/scripts/fix-offline-run-start-days.ts`
  (dry-run by default) to detect them and review the impact on existing attendance records
  before passing `--apply` — it only auto-corrects runs with zero recorded attendance;
  runs with attendance history must be reviewed and fixed manually.
