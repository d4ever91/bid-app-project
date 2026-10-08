import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { HttpError, ok, sendError } from './http.js';
import authRoutes from './routes/auth.js';
import userRoutes, { invites as inviteRoutes } from './routes/users.js';
import bidRoutes from './routes/bids.js';
import subscriptionRoutes from './routes/subscription.js';
import assistantRoutes from './routes/assistant.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // Browsers calling the API directly (not through the Vite proxy) need CORS with
  // credentials, because the refresh token travels as a cookie.
  const allowed = new Set(config.corsOrigins);
  app.use(
    cors({
      origin(origin, done) {
        // Same-origin and non-browser requests have no Origin header.
        if (!origin || allowed.has(origin.replace(/\/$/, ''))) return done(null, true);
        done(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization'],
      maxAge: 600
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.get('/health', (_req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));
  api.use('/auth', authRoutes);
  api.use('/users', userRoutes);
  api.use('/invites', inviteRoutes);
  api.use('/bids', bidRoutes);
  api.use('/subscription', subscriptionRoutes);
  api.use('/assistant', assistantRoutes);
  app.use('/api', api);

  app.use((req, res) => {
    sendError(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl.split('?')[0]}`);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message, err.fields);
    if (err?.type === 'entity.parse.failed') return sendError(res, 400, 'BAD_JSON', 'Request body is not valid JSON');
    if (err?.type === 'entity.too.large') return sendError(res, 413, 'TOO_LARGE', 'Request body is too large');
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    sendError(res, 500, 'INTERNAL', 'Something went wrong on the server');
  });

  return app;
}
