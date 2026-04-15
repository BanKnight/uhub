import { TRPCError, initTRPC } from '@trpc/server';
import type { Session, User } from 'better-auth';
import { createAuth } from '../auth/better-auth';
import { getDb } from '../db/schema';
import type { WorkerEnv } from '../index';

export type AdminSession = {
  session: Session;
  user: User;
};

const t = initTRPC.context<{ env: WorkerEnv; req: Request }>().create();

async function getAdminSession(env: WorkerEnv, request: Request): Promise<AdminSession | null> {
  const auth = createAuth(getDb(env));
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return session ? { session: session.session, user: session.user } : null;
}

export const createRouter = t.router;
export const publicProcedure = t.procedure;
export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
  const adminSession = await getAdminSession(ctx.env, ctx.req);

  if (!adminSession) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Admin authentication required',
    });
  }

  return next({
    ctx: {
      ...ctx,
      adminSession,
    },
  });
});
