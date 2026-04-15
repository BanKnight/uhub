import { portalExchangeInputSchema, portalExchangeResultSchema } from '@uhub/shared';
import { Hono } from 'hono';
import type { WorkerEnv } from '../../index';
import { findApiKeyByRawKey } from '../../services/api-keys';
import { createPortalSession } from '../../services/portal-sessions';

const PORTAL_COOKIE_NAME = 'portal_session';
const PORTAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const portalAuthRouter = new Hono<{ Bindings: WorkerEnv }>();

portalAuthRouter.post('/exchange', async (c) => {
  const parsed = portalExchangeInputSchema.safeParse(await c.req.json());

  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.flatten() }, 400);
  }

  const apiKey = await findApiKeyByRawKey(c.env, parsed.data.rawKey);

  if (!apiKey || apiKey.computedStatus !== 'active') {
    return c.json({ error: 'API key is not available for portal login' }, 401);
  }

  const session = await createPortalSession(c.env, apiKey.id);

  if (!session) {
    return c.json({ error: 'Failed to create portal session' }, 500);
  }

  c.header('Set-Cookie', `${PORTAL_COOKIE_NAME}=${session.id}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${PORTAL_COOKIE_MAX_AGE_SECONDS}`);

  const result = portalExchangeResultSchema.parse({
    sessionId: session.id,
    apiKeyId: apiKey.id,
    label: apiKey.label,
    expiresAt: session.expiresAt,
  });

  return c.json(result);
});
