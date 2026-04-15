import { createApiKeyInputSchema, revokeApiKeyInputSchema } from '@uhub/shared';
import { adminProcedure, createRouter } from '../../lib/trpc';
import { createApiKey, listApiKeys, revokeApiKey } from '../../services/api-keys';

export const apiKeysRouter = createRouter({
  list: adminProcedure.query(({ ctx }) => listApiKeys(ctx.env)),
  create: adminProcedure.input(createApiKeyInputSchema).mutation(({ ctx, input }) => createApiKey(ctx.env, input)),
  revoke: adminProcedure.input(revokeApiKeyInputSchema).mutation(({ ctx, input }) => revokeApiKey(ctx.env, input.id)),
});
