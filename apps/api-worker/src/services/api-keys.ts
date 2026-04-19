import { TRPCError } from '@trpc/server';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  ApiKey,
  ApiKeyUsageSummary,
  CreateApiKeyInput,
  CreateApiKeyResult,
} from '@uhub/shared';
import { apiKeyChannelRules, apiKeyEndpointRules, apiKeys, channels, getDb } from '../db/schema';
import { getApiKeyUsageSummaryRow } from '../repositories/requests-repo';
import type { WorkerEnv } from '../index';

type ApiKeyLookup = {
  id: string;
  label: string;
  keyPrefix: string;
  keyHash: string;
  status: 'active' | 'disabled' | 'expired' | 'revoked';
  expiresAt: number | null;
  maxConcurrency: number;
  requestQuotaLimit: number | null;
  createdByAdminId: string;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
  computedStatus: 'active' | 'disabled' | 'expired' | 'revoked';
  channelIds: string[];
  endpointRules: ApiKey['endpointRules'];
};

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return toHex(hash);
}

function buildRawKey() {
  return `uhub_${crypto.randomUUID().replaceAll('-', '')}`;
}

function buildPrefix(rawKey: string) {
  return rawKey.slice(0, 12);
}

async function getRules(env: WorkerEnv, apiKeyId: string) {
  const db = getDb(env);
  const [channelRules, endpointRules] = await Promise.all([
    db
      .select()
      .from(apiKeyChannelRules)
      .where(eq(apiKeyChannelRules.apiKeyId, apiKeyId))
      .orderBy(asc(apiKeyChannelRules.position)),
    db.select().from(apiKeyEndpointRules).where(eq(apiKeyEndpointRules.apiKeyId, apiKeyId)),
  ]);

  return {
    channelIds: channelRules.map((item) => item.channelId),
    endpointRules: endpointRules.map((item) => item.endpoint),
  };
}

async function hydrateApiKey(env: WorkerEnv, apiKeyId: string): Promise<ApiKey | null> {
  const db = getDb(env);
  const row = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get();

  if (!row) {
    return null;
  }

  const rules = await getRules(env, apiKeyId);

  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.keyPrefix,
    status: row.status,
    expiresAt: row.expiresAt ?? null,
    maxConcurrency: row.maxConcurrency,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    channelIds: rules.channelIds,
    endpointRules: rules.endpointRules,
    quota: {
      requestLimit: row.requestQuotaLimit ?? null,
    },
  };
}

async function assertActiveChannels(env: WorkerEnv, channelIds: string[]) {
  const db = getDb(env);
  const uniqueChannelIds = [...new Set(channelIds)];
  const rows = await db.select().from(channels).where(inArray(channels.id, uniqueChannelIds));

  if (rows.length !== uniqueChannelIds.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'One or more channels do not exist',
    });
  }

  if (rows.some((channel) => channel.status !== 'active')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'API keys can only be issued for active channels',
    });
  }

  return uniqueChannelIds;
}

export async function getApiKeyUsageSummary(
  env: WorkerEnv,
  apiKeyId: string
): Promise<ApiKeyUsageSummary> {
  return getApiKeyUsageSummaryRow(env, apiKeyId);
}

export async function listApiKeys(env: WorkerEnv): Promise<ApiKey[]> {
  const db = getDb(env);
  const rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  const hydrated = await Promise.all(rows.map((row) => hydrateApiKey(env, row.id)));

  return hydrated.filter((item): item is ApiKey => item !== null);
}

export async function createApiKey(
  env: WorkerEnv,
  input: CreateApiKeyInput
): Promise<CreateApiKeyResult> {
  const db = getDb(env);
  const now = Date.now();
  const id = crypto.randomUUID();
  const rawKey = buildRawKey();
  const keyPrefix = buildPrefix(rawKey);
  const keyHash = await sha256(rawKey);
  const channelIds = await assertActiveChannels(env, input.channelIds);

  await db.insert(apiKeys).values({
    id,
    label: input.label,
    keyPrefix,
    keyHash,
    status: 'active',
    expiresAt: input.expiresAt ?? null,
    maxConcurrency: input.maxConcurrency,
    requestQuotaLimit: input.quota?.requestLimit ?? null,
    createdByAdminId: 'bootstrap-admin',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(apiKeyChannelRules).values(
    channelIds.map((channelId, index) => ({
      apiKeyId: id,
      channelId,
      position: index,
    }))
  );

  await db.insert(apiKeyEndpointRules).values(
    input.endpointRules.map((endpoint) => ({
      apiKeyId: id,
      endpoint,
    }))
  );

  const apiKey = await hydrateApiKey(env, id);

  if (!apiKey) {
    throw new Error('Created api key could not be loaded');
  }

  return {
    rawKey,
    apiKey,
  };
}

export async function getApiKeyById(env: WorkerEnv, apiKeyId: string): Promise<ApiKey | null> {
  return hydrateApiKey(env, apiKeyId);
}

export async function revokeApiKey(env: WorkerEnv, apiKeyId: string): Promise<ApiKey> {
  const db = getDb(env);
  const now = Date.now();

  const existing = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get();

  if (!existing) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'API key not found',
    });
  }

  await db
    .update(apiKeys)
    .set({
      status: 'revoked',
      revokedAt: now,
      updatedAt: now,
    })
    .where(eq(apiKeys.id, apiKeyId));

  const apiKey = await hydrateApiKey(env, apiKeyId);

  if (!apiKey) {
    throw new Error('Revoked api key could not be loaded');
  }

  return apiKey;
}

export async function rotateApiKey(env: WorkerEnv, apiKeyId: string): Promise<CreateApiKeyResult> {
  const db = getDb(env);
  const now = Date.now();
  const existing = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get();

  if (!existing) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'API key not found',
    });
  }

  const rules = await getRules(env, apiKeyId);

  await db
    .update(apiKeys)
    .set({
      status: 'revoked',
      revokedAt: now,
      updatedAt: now,
    })
    .where(eq(apiKeys.id, apiKeyId));

  return createApiKey(env, {
    label: existing.label,
    channelIds: rules.channelIds,
    endpointRules: rules.endpointRules,
    maxConcurrency: existing.maxConcurrency,
    expiresAt: existing.expiresAt ?? null,
    quota: {
      requestLimit: existing.requestQuotaLimit ?? null,
    },
  });
}

export async function findApiKeyByRawKey(
  env: WorkerEnv,
  rawKey: string
): Promise<ApiKeyLookup | null> {
  const db = getDb(env);
  const keyHash = await sha256(rawKey);
  const row = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).get();

  if (!row) {
    return null;
  }

  const now = Date.now();
  const computedStatus =
    typeof row.expiresAt === 'number' && row.expiresAt <= now ? 'expired' : row.status;
  const rules = await getRules(env, row.id);

  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.keyPrefix,
    keyHash: row.keyHash,
    status: row.status,
    expiresAt: row.expiresAt ?? null,
    maxConcurrency: row.maxConcurrency,
    requestQuotaLimit: row.requestQuotaLimit ?? null,
    createdByAdminId: row.createdByAdminId,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    computedStatus,
    channelIds: rules.channelIds,
    endpointRules: rules.endpointRules,
  };
}
