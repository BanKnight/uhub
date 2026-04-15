import { Hono } from 'hono';
import type { WorkerEnv } from '../../index';
import { listRequestsByApiKey } from '../../repositories/requests-repo';
import { getPortalSessionApiKey } from '../../services/portal-sessions';

export const portalRequestsRouter = new Hono<{ Bindings: WorkerEnv }>();

portalRequestsRouter.get('/requests', async (c) => {
  const apiKey = await getPortalSessionApiKey(c.env, c.req.raw);

  if (!apiKey) {
    return c.json({ error: 'Portal session is not available' }, 401);
  }

  const requests = await listRequestsByApiKey(c.env, apiKey.id);
  return c.json(requests);
});
