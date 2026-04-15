import { createRouter } from '../lib/trpc';
import { analyticsRouter } from './admin/analytics';
import { auditRouter } from './admin/audit';
import { apiKeysRouter } from './admin/api-keys';
import { apiKeyRotationRouter } from './admin/api-key-rotation';
import { channelsRouter } from './admin/channels';

export const appRouter = createRouter({
  admin: createRouter({
    analytics: analyticsRouter,
    audit: auditRouter,
    channels: channelsRouter,
    apiKeys: apiKeysRouter,
    apiKeyRotation: apiKeyRotationRouter,
  }),
});

export type AppRouter = typeof appRouter;
