import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { trpcMiddleware } from './trpc/server';
import {
  getTelegramWebhookSecret,
  handleTelegramWebhook,
  runTelegramScheduledReports,
  validateCronSecret,
} from './services/telegram-reports';

dotenv.config();

const app = express();
const TASHKENT_OFFSET_MINUTES = 5 * 60;
const TELEGRAM_SCHEDULER_INTERVAL_MS = 30_000;
const internalSchedulerRuns = new Set<string>();

function toTashkentDate(date: Date): Date {
  return new Date(date.getTime() + TASHKENT_OFFSET_MINUTES * 60_000);
}

function tashkentYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shouldRunInternalScheduler(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  const flag = (process.env.TELEGRAM_INTERNAL_SCHEDULER_ENABLED || 'true').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
}

function startTelegramInternalScheduler(): void {
  if (!shouldRunInternalScheduler()) return;

  const tick = async () => {
    const now = new Date();
    const localNow = toTashkentDate(now);
    const minute = localNow.getMinutes();
    const hour = localNow.getHours();
    const weekday = localNow.getDay(); // 0=Sun, 1=Mon
    const dayOfMonth = localNow.getDate();
    const dayKey = tashkentYmd(localNow);

    if (minute !== 0) return;

    const runJob = async (
      key: string,
      params: { kind: 'daily' | 'weekly' | 'monthly'; audience: 'admin_manager' | 'curators'; slot?: 'noon' | 'evening' },
    ) => {
      if (internalSchedulerRuns.has(key)) return;
      internalSchedulerRuns.add(key);
      try {
        const result = await runTelegramScheduledReports({
          kind: params.kind,
          audience: params.audience,
          slot: params.slot,
        });
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'telegram_internal_scheduler_sent',
            key,
            ...result,
          }),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'telegram_internal_scheduler_failed',
            key,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    };

    if (hour === 8) {
      await runJob(`admin_manager:daily:${dayKey}`, { kind: 'daily', audience: 'admin_manager' });
      if (weekday === 1) {
        await runJob(`admin_manager:weekly:${dayKey}`, { kind: 'weekly', audience: 'admin_manager' });
      }
      if (dayOfMonth === 1) {
        await runJob(`admin_manager:monthly:${dayKey}`, { kind: 'monthly', audience: 'admin_manager' });
      }
    }

    if (hour === 12) {
      await runJob(`curators:noon:${dayKey}`, { kind: 'daily', audience: 'curators', slot: 'noon' });
    }
    if (hour === 18) {
      await runJob(`curators:evening:${dayKey}`, { kind: 'daily', audience: 'curators', slot: 'evening' });
    }
  };

  // Run once quickly after boot, then on interval.
  setTimeout(() => {
    void tick();
  }, 5_000);
  setInterval(() => {
    void tick();
  }, TELEGRAM_SCHEDULER_INTERVAL_MS);
}

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((v) => v.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
        return callback(null, true);
      }
      return callback(new Error('CORS blocked'));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - started;
    const isSlow = durationMs >= 1000;
    if (isSlow || res.statusCode >= 500) {
      console.log(
        JSON.stringify({
          level: isSlow ? 'warn' : 'error',
          event: 'http_request',
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
        }),
      );
    }
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/ready', (_req, res) => {
  res.json({ status: 'ready', timestamp: new Date().toISOString() });
});

app.post('/webhooks/telegram', async (req, res) => {
  const expectedSecret = getTelegramWebhookSecret();
  if (!expectedSecret) {
    return res.status(503).json({ ok: false, error: 'Webhook secret not configured' });
  }

  const providedSecret = String(req.header('x-telegram-bot-api-secret-token') || '');
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
  }

  try {
    const result = await handleTelegramWebhook(req.body);
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'telegram_webhook_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return res.status(500).json({ ok: false, error: 'Webhook processing failed' });
  }
});

const handleTelegramReportRun: express.RequestHandler = async (req, res) => {
  const authHeader = String(req.header('authorization') || '');
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const bodyToken = typeof req.body?.token === 'string' ? req.body.token : null;
  const providedSecret = bearer || queryToken || bodyToken;

  if (!validateCronSecret(providedSecret)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const periodRaw =
    typeof req.body?.period === 'string'
      ? req.body.period
      : typeof req.query.period === 'string'
        ? req.query.period
        : 'daily';
  const period = periodRaw === 'weekly' || periodRaw === 'monthly' ? periodRaw : 'daily';
  const audienceRaw =
    typeof req.body?.audience === 'string'
      ? req.body.audience
      : typeof req.query.audience === 'string'
        ? req.query.audience
        : 'admin_manager';
  const audience = audienceRaw === 'curators' ? 'curators' : 'admin_manager';
  const slotRaw =
    typeof req.body?.slot === 'string'
      ? req.body.slot
      : typeof req.query.slot === 'string'
        ? req.query.slot
        : 'noon';
  const slot = slotRaw === 'evening' ? 'evening' : 'noon';

  try {
    const result = await runTelegramScheduledReports({
      kind: period,
      audience,
      slot,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'telegram_report_cron_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Failed' });
  }
};

app.post('/internal/reports/telegram/run', handleTelegramReportRun);
app.get('/internal/reports/telegram/run', handleTelegramReportRun);

app.use('/api/trpc', trpcMiddleware);

app.get('/api', (_req, res) => {
  res.json({ message: 'Kuratordashboard API v1', trpc: '/api/trpc' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unhandled_error',
      message: err instanceof Error ? err.message : String(err),
    }),
  );

  const message =
    err instanceof Error && err.message === 'CORS blocked'
      ? 'CORS blocked'
      : 'Server xatosi';

  const statusCode = message === 'CORS blocked' ? 403 : 500;
  res.status(statusCode).json({ error: message });
});

startTelegramInternalScheduler();

export default app;
