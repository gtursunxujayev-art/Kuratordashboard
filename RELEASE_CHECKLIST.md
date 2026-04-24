# Release Checklist (Kuratordashboard)

1. Verify environment parity:
- `DATABASE_URL` points to the shared production DB.
- `JWT_SECRET` is set (API startup fails fast if missing) and matches Dashboarduz when shared login is expected.
- `NEXT_PUBLIC_API_URL` points to Railway production API.
- `CORS_ORIGIN` includes Vercel production URL.

2. Deploy backend first:
- Apply DB migration (`packages/db/prisma/migrations/20260405190000_kd_final_spec`).
- Apply DB migration (`packages/db/prisma/migrations/20260424213000_student_profile_enrichment`) before API deploy.
- Deploy API and confirm `/health` and `/ready` both return 200.
- Smoke test `auth.loginWithPassword` and `auth.me`.

3. Deploy frontend second:
- Confirm built bundle contains production Railway API URL.
- Login with a Dashboarduz-created Admin/Manager account.

4. Critical smoke tests:
- Dashboard filters work (`today/this_week/last_week/this_month/last_month/all`).
- Students page combined filters work together.
- Amaliy `today/yesterday/all` works and `all` is admin-only.
- Premium/VIP attendance tracking does not fail for non-premium students.
- Deactivated user with previously valid token receives `UNAUTHORIZED` on protected endpoints.
- Admin role removal takes effect immediately (admin-only endpoints reject old token).

5. Post-release checks:
- Inspect API logs for slow requests (`durationMs >= 1000`).
- Watch for repeated `UNAUTHORIZED`, `FORBIDDEN`, or `CORS blocked` errors.
- Track short-term `UNAUTHORIZED` increase during rollout while old sessions are revalidated.
