import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { isConnected } from './db.js';
import { HttpError, ok, sendError } from './http.js';
import authRoutes from './routes/auth.js';
import userRoutes, { invites as inviteRoutes } from './routes/users.js';
import bidRoutes from './routes/bids.js';
import subscriptionRoutes from './routes/subscription.js';
import assistantRoutes from './routes/assistant.js';
import overviewRoutes from './routes/overview.js';

const DB_DOWN_MESSAGE =
  "The API can't reach MongoDB. Start MongoDB (e.g. `npm run db:up`) or check MONGODB_URI in server/.env.";

const isMongoConnectivityError = (err: unknown): boolean => {
  const e = err as { code?: unknown; name?: string } | null;
  return e?.code === 'DB_NOT_CONNECTED' || /^Mongo(ServerSelection|Network|NotConnected|TopologyClosed)/.test(e?.name ?? '');
};

export function createApp(): express.Express {
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
  api.get('/health', (_req, res) =>
    ok(res, { status: isConnected() ? 'ok' : 'degraded', database: isConnected() ? 'connected' : 'disconnected', time: new Date().toISOString() })
  );

  // Everything below needs MongoDB. While it's unreachable, say so plainly instead of hanging.
  api.use((_req, res, next) => {
    if (isConnected()) return next();
    sendError(res, 503, 'DB_UNAVAILABLE', DB_DOWN_MESSAGE);
  });
  api.use('/auth', authRoutes);
  api.use('/overview', overviewRoutes);
  api.use('/users', userRoutes);
  api.use('/invites', inviteRoutes);
  api.use('/bids', bidRoutes);
  api.use('/subscription', subscriptionRoutes);
  api.use('/assistant', assistantRoutes);
  app.use('/api', api);

  app.use((req: Request, res: Response) => {
    sendError(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl.split('?')[0]}`);
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message, err.fields);
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') return sendError(res, 400, 'BAD_JSON', 'Request body is not valid JSON');
    if (type === 'entity.too.large') return sendError(res, 413, 'TOO_LARGE', 'Request body is too large');
    if (isMongoConnectivityError(err)) {
      console.error(`[db] ${req.method} ${req.originalUrl}: ${(err as Error).message}`);
      return sendError(res, 503, 'DB_UNAVAILABLE', DB_DOWN_MESSAGE);
    }
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    sendError(res, 500, 'INTERNAL', 'Something went wrong on the server');
  });

  return app;
}
