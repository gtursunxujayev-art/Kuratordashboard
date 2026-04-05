import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { trpcMiddleware } from './trpc/server';

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

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.use('/api/trpc', trpcMiddleware);

app.get('/api', (_req, res) => {
  res.json({ message: 'Kuratordashboard API v1', trpc: '/api/trpc' });
});

export default app;
