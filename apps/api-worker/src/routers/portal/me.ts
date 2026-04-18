import type { PortalOverview } from '@uhub/shared';
import { Hono } from 'hono';
import type { WorkerEnv } from '../../index';
import { getApiKeyUsageSummary } from '../../services/api-keys';
import { getPortalSessionApiKey } from '../../services/portal-sessions';

export const portalMeRouter = new Hono<{ Bindings: WorkerEnv }>();

portalMeRouter.get('/me', async (c) => {
  const apiKey = await getPortalSessionApiKey(c.env, c.req.raw);

  if (!apiKey) {
    return c.json({ error: 'Portal session is not available' }, 401);
  }

  const usage = await getApiKeyUsageSummary(c.env, apiKey.id);
  const overview: PortalOverview = {
    apiKey,
    usage,
  };

  return c.json(overview);
});
