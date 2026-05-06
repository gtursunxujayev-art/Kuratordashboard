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

app.post('/internal/reports/telegram/run', async (req, res) => {
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

  try {
    const result = await runTelegramScheduledReports(period);
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
});

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

export default app;
