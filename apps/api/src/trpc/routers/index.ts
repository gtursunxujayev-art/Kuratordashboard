import { router } from '../trpc';
import { authRouter } from './auth';
import { dashboardRouter } from './dashboard';
import { studentsRouter } from './students';
import { amaliyRouter } from './amaliy';
import { settingsRouter } from './settings';
import { kuratorsRouter } from './kurators';

export const appRouter = router({
  auth: authRouter,
  dashboard: dashboardRouter,
  students: studentsRouter,
  amaliy: amaliyRouter,
  settings: settingsRouter,
  kurators: kuratorsRouter,
});

export type AppRouter = typeof appRouter;
