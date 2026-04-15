import { Hono } from 'hono';
import type { WorkerEnv } from '../../index';
import { getPortalSessionApiKey } from '../../services/portal-sessions';

export const portalMeRouter = new Hono<{ Bindings: WorkerEnv }>();

portalMeRouter.get('/me', async (c) => {
  const apiKey = await getPortalSessionApiKey(c.env, c.req.raw);

  if (!apiKey) {
    return c.json({ error: 'Portal session is not available' }, 401);
  }

  return c.json(apiKey);
});
