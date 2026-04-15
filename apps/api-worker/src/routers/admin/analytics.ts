import { adminProcedure, createRouter } from '../../lib/trpc';
import { getAnalyticsSummary } from '../../services/analytics';

export const analyticsRouter = createRouter({
  summary: adminProcedure.query(({ ctx }) => getAnalyticsSummary(ctx.env)),
});
