import { adminProcedure, createRouter } from '../../lib/trpc';
import { listRecentRequestsForAdmin } from '../../repositories/requests-repo';

export const auditRouter = createRouter({
  list: adminProcedure.query(({ ctx }) => listRecentRequestsForAdmin(ctx.env)),
});
