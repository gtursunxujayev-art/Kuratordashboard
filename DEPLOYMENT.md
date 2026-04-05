# Deployment Notes

## Required environment variables

### API (Railway)
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN` (optional, default `7d`)
- `PORT`
- `NODE_ENV`
- `CORS_ORIGIN` (comma-separated if multiple)

### Web (Vercel)
- `NEXT_PUBLIC_API_URL`

## Shared-login requirement

If Kuratordashboard and Dashboarduz use the same database and shared credentials,
`JWT_SECRET` should be aligned with Dashboarduz.

## Deploy order

1. Database migration
2. API deployment
3. Web deployment

This order prevents UI/backend contract mismatch during rollout.
