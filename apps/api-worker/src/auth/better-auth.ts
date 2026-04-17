import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { accounts, schema, users } from '../db/schema';

function readProcessEnv(name: 'ADMIN_EMAIL' | 'ADMIN_PASSWORD') {
  return (
    (
      globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env?.[name] ?? undefined
  );
}

export function resolveAdminEmail(env?: { ADMIN_EMAIL?: string }) {
  const value = env?.ADMIN_EMAIL ?? readProcessEnv('ADMIN_EMAIL');

  if (!value) {
    throw new Error('ADMIN_EMAIL is required');
  }

  return value.toLowerCase();
}

export function resolveAdminPassword(env?: { ADMIN_PASSWORD?: string }) {
  const value = env?.ADMIN_PASSWORD ?? readProcessEnv('ADMIN_PASSWORD');

  if (!value) {
    throw new Error('ADMIN_PASSWORD is required');
  }

  return value;
}

export async function ensureAdminAccount(
  db: DrizzleD1Database<typeof schema>,
  env?: { ADMIN_EMAIL?: string; ADMIN_PASSWORD?: string }
) {
  const adminEmail = resolveAdminEmail(env);
  const adminPassword = resolveAdminPassword(env);

  let user = await db.select().from(users).where(eq(users.email, adminEmail)).get();

  if (!user) {
    const now = new Date();
    const userId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      name: 'Admin',
      email: adminEmail,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    });

    user = await db.select().from(users).where(eq(users.id, userId)).get();
  }

  if (!user) {
    throw new Error('Admin user could not be loaded');
  }

  const credentialAccount = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')))
    .get();

  const now = new Date();
  const passwordHash = await hashPassword(adminPassword);

  if (!credentialAccount) {
    await db.insert(accounts).values([
      {
        id: crypto.randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  } else if (
    !credentialAccount.password ||
    !(await verifyPassword({ hash: credentialAccount.password, password: adminPassword }))
  ) {
    await db
      .update(accounts)
      .set({
        password: passwordHash,
        updatedAt: now,
      })
      .where(eq(accounts.id, credentialAccount.id));
  }

  return user;
}

export function createAuth(db: DrizzleD1Database<typeof schema>) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
  });
}
