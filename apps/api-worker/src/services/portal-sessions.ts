import { and, eq, isNull } from 'drizzle-orm';
import type { ApiKey } from '@uhub/shared';
import { getDb, portalSessions } from '../db/schema';
import type { WorkerEnv } from '../index';
import { getApiKeyById } from './api-keys';

const PORTAL_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type PortalSessionRecord = {
  id: string;
  apiKeyId: string;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
  createdAt: number;
};

function readPortalSessionId(request: Request) {
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)portal_session=([^;]+)/);
  return match?.[1] ?? null;
}

export async function createPortalSession(env: WorkerEnv, apiKeyId: string): Promise<PortalSessionRecord | null> {
  const db = getDb(env);
  const now = Date.now();
  const id = crypto.randomUUID();
  const expiresAt = now + PORTAL_SESSION_TTL_MS;

  await db.insert(portalSessions).values({
    id,
    apiKeyId,
    expiresAt,
    lastSeenAt: now,
    revokedAt: null,
    createdAt: now,
  });

  const session = await db.select().from(portalSessions).where(eq(portalSessions.id, id)).get();

  if (!session) {
    return null;
  }

  return {
    id: session.id,
    apiKeyId: session.apiKeyId,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    revokedAt: session.revokedAt ?? null,
    createdAt: session.createdAt,
  };
}

export async function getPortalSession(env: WorkerEnv, request: Request): Promise<PortalSessionRecord | null> {
  const sessionId = readPortalSessionId(request);

  if (!sessionId) {
    return null;
  }

  const db = getDb(env);
  const session = await db
    .select()
    .from(portalSessions)
    .where(and(eq(portalSessions.id, sessionId), isNull(portalSessions.revokedAt)))
    .get();

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    return null;
  }

  return {
    id: session.id,
    apiKeyId: session.apiKeyId,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    revokedAt: session.revokedAt ?? null,
    createdAt: session.createdAt,
  };
}

export async function getPortalSessionApiKey(env: WorkerEnv, request: Request): Promise<ApiKey | null> {
  const session = await getPortalSession(env, request);

  if (!session) {
    return null;
  }

  const apiKey = await getApiKeyById(env, session.apiKeyId);

  if (!apiKey) {
    return null;
  }

  if (apiKey.status !== 'active') {
    return null;
  }

  if (typeof apiKey.expiresAt === 'number' && apiKey.expiresAt <= Date.now()) {
    return null;
  }

  return apiKey;
}
