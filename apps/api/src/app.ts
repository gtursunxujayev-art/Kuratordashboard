import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from '@kuratordashboard/db';
import { trpcMiddleware } from './trpc/server';
import {
  getTelegramWebhookSecret,
  handleTelegramWebhook,
  processDueTelegramScheduledSlots,
  runTelegramScheduledReports,
  validateCronSecret,
} from './services/telegram-reports';
import { handleFaceIdWebhook } from './services/attendance/faceid';

dotenv.config();

const app = express();
const TELEGRAM_SCHEDULER_INTERVAL_MS = 30_000;
const TELEGRAM_REQUEST_TICK_INTERVAL_MS = 10 * 60_000;

let requestDrivenSchedulerLastRunAt = 0;
let requestDrivenSchedulerRunning = false;

function shouldRunInternalScheduler(): boolean {
  return process.env.NODE_ENV !== 'test';
}

function startTelegramInternalScheduler(): void {
  if (!shouldRunInternalScheduler()) {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'telegram_internal_scheduler_disabled',
        reason: 'test_environment',
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'telegram_internal_scheduler_started',
      intervalMs: TELEGRAM_SCHEDULER_INTERVAL_MS,
      timezone: process.env.REPORT_TIMEZONE || 'Asia/Tashkent',
    }),
  );

  let isTickRunning = false;

  const tick = async () => {
    if (isTickRunning) return;
    isTickRunning = true;
    try {
      const result = await processDueTelegramScheduledSlots(new Date());
      console.log(
        JSON.stringify({
          level: result.failed > 0 ? 'warn' : 'info',
          event: 'telegram_internal_scheduler_tick',
          ...result,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'telegram_internal_scheduler_failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      isTickRunning = false;
    }
  };

  // Run immediately after boot, then on interval.
  setImmediate(() => {
    void tick();
  });
  setInterval(() => {
    void tick();
  }, TELEGRAM_SCHEDULER_INTERVAL_MS);
}

function triggerRequestDrivenSchedulerTick(reason: string): void {
  if (process.env.NODE_ENV === 'test') return;
  const nowMs = Date.now();
  if (requestDrivenSchedulerRunning) return;
  if (nowMs - requestDrivenSchedulerLastRunAt < TELEGRAM_REQUEST_TICK_INTERVAL_MS) return;
  requestDrivenSchedulerLastRunAt = nowMs;
  requestDrivenSchedulerRunning = true;
  void processDueTelegramScheduledSlots(new Date())
    .then((result) => {
      console.log(
        JSON.stringify({
          level: result.failed > 0 ? 'warn' : 'info',
          event: 'telegram_internal_scheduler_request_tick',
          reason,
          ...result,
        }),
      );
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'telegram_internal_scheduler_request_tick_failed',
          reason,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    })
    .finally(() => {
      requestDrivenSchedulerRunning = false;
    });
}

const configuredOrigins = process.env.CORS_ORIGIN || process.env.FRONTEND_URL;
const allowedOrigins = (configuredOrigins || 'http://localhost:3000,http://127.0.0.1:3000')
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
app.use((req, _res, next) => {
  triggerRequestDrivenSchedulerTick(req.path || req.originalUrl || 'request');
  next();
});

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

app.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'not_ready', timestamp: new Date().toISOString() });
  }
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

function getFaceIdWebhookSecret(): string | null {
  return process.env.FACEID_WEBHOOK_SECRET?.trim() || null;
}

function extractFaceIdToken(req: express.Request): string | null {
  const auth = String(req.header('authorization') || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  if (bearer) return bearer;
  return String(req.header('x-faceid-webhook-secret') || '').trim() || null;
}

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.get('/webhooks/faceid', (_req, res) => {
  res.json({
    ok: true,
    endpoint: '/webhooks/faceid',
    method: 'POST',
    message: 'Face ID student attendance webhook is alive.',
    auth: ['Authorization: Bearer <token>', 'x-faceid-webhook-secret: <token>'],
  });
});

app.post('/webhooks/faceid', async (req, res) => {
  const expectedSecret = getFaceIdWebhookSecret();
  if (!expectedSecret) {
    return res.status(503).json({ ok: false, error: 'FACEID_WEBHOOK_SECRET sozlanmagan' });
  }

  const providedToken = extractFaceIdToken(req);
  if (!providedToken || !tokensMatch(providedToken, expectedSecret)) {
    return res.status(401).json({ ok: false, error: 'Invalid Face ID webhook token' });
  }

  try {
    const result = await handleFaceIdWebhook(req.body);
    return res.json(result);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'faceid_webhook_failed',
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
  const providedSecret = bearer || String(req.header('x-internal-secret') || '').trim() || null;

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
