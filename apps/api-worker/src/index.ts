import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createAuth } from './auth/better-auth';
import { getDb } from './db/schema';
import { ApiKeyConcurrencyDurableObject } from './durable-objects/api-key-concurrency-do';
import { chatCompletionsRouter } from './routers/gateway/chat-completions';
import { portalAuthRouter } from './routers/portal/auth';
import { portalMeRouter } from './routers/portal/me';
import { portalRequestsRouter } from './routers/portal/requests';
import { appRouter } from './routers';

export type WorkerEnv = {
  DB: D1Database;
  API_KEY_CONCURRENCY: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: WorkerEnv }>();

const adminOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const portalOrigins = new Set(['http://localhost:5174', 'http://127.0.0.1:5174']);

function resolveCorsOrigin(origin: string | undefined, allowedOrigins: Set<string>) {
  if (origin && allowedOrigins.has(origin)) {
    return origin;
  }

  return null;
}

app.use(
  '/api/auth/*',
  cors({
    credentials: true,
    origin: (origin) => resolveCorsOrigin(origin, adminOrigins),
  })
);
app.use(
  '/trpc/*',
  cors({
    credentials: true,
    origin: (origin) => resolveCorsOrigin(origin, adminOrigins),
  })
);
app.use(
  '/portal/*',
  cors({
    credentials: true,
    origin: (origin) => resolveCorsOrigin(origin, portalOrigins),
  })
);

app.get('/healthz', (c) => c.json({ ok: true }));

app.all('/api/auth/*', async (c) => {
  const db = getDb(c.env);
  const auth = createAuth(db);
  return auth.handler(c.req.raw);
});

app.route('/portal/auth', portalAuthRouter);
app.route('/portal', portalMeRouter);
app.route('/portal', portalRequestsRouter);
app.route('/v1', chatCompletionsRouter);

app.all('/trpc/*', async (c) => {
  return fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: (_opts: FetchCreateContextFnOptions) => ({ env: c.env, req: c.req.raw }),
  });
});

export { ApiKeyConcurrencyDurableObject };
export default app;
