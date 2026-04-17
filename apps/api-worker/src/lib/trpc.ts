import { TRPCError, initTRPC } from '@trpc/server';
import type { Session, User } from 'better-auth';
import { createAuth, resolveAdminEmail } from '../auth/better-auth';
import { getDb, users } from '../db/schema';
import { eq } from 'drizzle-orm';
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
  const adminUser = await getDb(ctx.env)
    .select()
    .from(users)
    .where(eq(users.email, resolveAdminEmail(ctx.env)))
    .get();

  if (!adminSession || !adminUser || adminSession.user.id !== adminUser.id) {
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
