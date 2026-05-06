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
4. Configure Telegram webhook + Railway cron jobs

This order prevents UI/backend contract mismatch during rollout.

## Telegram cron endpoints

- Webhook: `POST /webhooks/telegram` with `x-telegram-bot-api-secret-token`.
- Scheduler: `POST /internal/reports/telegram/run`
  - Auth via `Authorization: Bearer <REPORT_CRON_SECRET>`
  - Body/query: `period=daily|weekly|monthly`
