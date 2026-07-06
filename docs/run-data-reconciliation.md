# Course-run reconciliation rollout

Run this before deploying migrations `20260628180000_unique_active_kurator_assignment` and
`20260706120000_sync_course_run_members_from_incomes` to an existing database.

1. Back up PostgreSQL.
2. Export a dry-run report:
   `npm run reconcile:runs --workspace @kuratordashboard/api -- --export run-conflicts.json`
3. Review both conflict rows and stale memberships. A stale membership is a current/future run member without an active `new_sale` on that run's course. Ended-run memberships are never removed.
4. Apply the same deterministic precedence and rebuild the curator cache:
   `npm run reconcile:runs --workspace @kuratordashboard/api -- --apply --export applied-run-conflicts.json`
5. Deploy migrations and verify that no student has multiple current/future memberships for one course, no current/future member lacks an active course sale, and no student/run has multiple active curator assignments.
6. Verify from the shared sales application that a tariff-only change keeps the roster row, while deleting or moving the final active course sale removes only current/future rows from the old course.

The income trigger never assigns a student to a new run. New-course placement remains an explicit administrator action.

Exercise logs intentionally have no `courseRunId`. Reads and writes isolate them by the selected run's inclusive date window. A legacy log whose date falls inside overlapping historical runs is therefore ambiguous and can appear in either run; reconciliation does not rewrite those logs.
