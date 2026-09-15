import { router } from '../trpc';
import { authRouter } from './auth';
import { dashboardRouter } from './dashboard';
import { studentsRouter } from './students';
import { amaliyRouter } from './amaliy';
import { settingsRouter } from './settings';
import { kuratorsRouter } from './kurators';
import { faceidRouter } from './faceid';
import { intensivRouter } from './intensiv';
import { clientBotRouter } from './client-bot';
import { messagesRouter } from './messages';

export const appRouter = router({
  auth: authRouter,
  dashboard: dashboardRouter,
  students: studentsRouter,
  amaliy: amaliyRouter,
  settings: settingsRouter,
  kurators: kuratorsRouter,
  faceid: faceidRouter,
  intensiv: intensivRouter,
  clientBot: clientBotRouter,
  messages: messagesRouter,
});

export type AppRouter = typeof appRouter;
