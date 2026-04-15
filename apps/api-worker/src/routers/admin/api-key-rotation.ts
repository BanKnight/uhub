import { rotateApiKeyInputSchema } from '@uhub/shared';
import { adminProcedure, createRouter } from '../../lib/trpc';
import { rotateApiKey } from '../../services/api-keys';

export const apiKeyRotationRouter = createRouter({
  rotate: adminProcedure.input(rotateApiKeyInputSchema).mutation(({ ctx, input }) => rotateApiKey(ctx.env, input.id)),
});
