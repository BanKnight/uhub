import { createRouter } from '../lib/trpc';
import { apiKeysRouter } from './admin/api-keys';
import { channelsRouter } from './admin/channels';

export const appRouter = createRouter({
  admin: createRouter({
    channels: channelsRouter,
    apiKeys: apiKeysRouter,
  }),
});

export type AppRouter = typeof appRouter;
