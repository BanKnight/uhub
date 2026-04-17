import { auditListInputSchema } from '@uhub/shared';
import { adminProcedure, createRouter } from '../../lib/trpc';
import { listRecentRequestsForAdmin } from '../../repositories/requests-repo';

export const auditRouter = createRouter({
  list: adminProcedure
    .input(auditListInputSchema.optional())
    .query(({ ctx, input }) => listRecentRequestsForAdmin(ctx.env, input)),
});
