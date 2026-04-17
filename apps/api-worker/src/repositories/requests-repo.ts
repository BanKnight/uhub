import type {
  AuditListInput,
  AuditRequestItem,
  GatewayEndpoint,
  GatewayFailureClass,
  GatewayRequestStatus,
  RequestHistoryItem,
} from '@uhub/shared';
import { and, desc, eq, like } from 'drizzle-orm';
import { apiKeys, channels, getDb, requests } from '../db/schema';
import type { WorkerEnv } from '../index';

type CreateRequestRecordInput = {
  apiKeyId: string;
  endpoint: GatewayEndpoint;
  model: string | null;
  channelId: string | null;
  traceId: string;
  requestSize: number | null;
};

type FinishRequestRecordInput = {
  id: string;
  status: GatewayRequestStatus;
  failureClass: GatewayFailureClass | null;
  channelId?: string | null;
  httpStatus: number | null;
  latencyMs: number;
  responseSize: number | null;
};

export async function createRequestRecord(env: WorkerEnv, input: CreateRequestRecordInput) {
  const db = getDb(env);
  const now = Date.now();
  const id = crypto.randomUUID();

  await db.insert(requests).values({
    id,
    apiKeyId: input.apiKeyId,
    endpoint: input.endpoint,
    model: input.model,
    channelId: input.channelId,
    traceId: input.traceId,
    status: 'pending',
    failureClass: null,
    httpStatus: null,
    latencyMs: null,
    requestSize: input.requestSize,
    responseSize: null,
    payloadRef: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
  });

  return { id, startedAt: now };
}

export async function listRequestsByApiKey(
  env: WorkerEnv,
  apiKeyId: string
): Promise<RequestHistoryItem[]> {
  const db = getDb(env);
  const rows = await db
    .select()
    .from(requests)
    .where(eq(requests.apiKeyId, apiKeyId))
    .orderBy(desc(requests.createdAt))
    .limit(20);

  return rows.map((row) => ({
    id: row.id,
    endpoint: row.endpoint as GatewayEndpoint,
    model: row.model ?? null,
    channelId: row.channelId ?? null,
    traceId: row.traceId ?? null,
    status: row.status,
    failureClass: row.failureClass ?? null,
    httpStatus: row.httpStatus ?? null,
    latencyMs: row.latencyMs ?? null,
    requestSize: row.requestSize ?? null,
    responseSize: row.responseSize ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
  }));
}

export async function listRecentRequestsForAdmin(
  env: WorkerEnv,
  input: AuditListInput = {}
): Promise<AuditRequestItem[]> {
  const db = getDb(env);
  const filters = [
    input.endpoint ? eq(requests.endpoint, input.endpoint) : undefined,
    input.status ? eq(requests.status, input.status) : undefined,
    input.failureClass ? eq(requests.failureClass, input.failureClass) : undefined,
    input.apiKeyPrefix ? like(apiKeys.keyPrefix, `${input.apiKeyPrefix}%`) : undefined,
    input.traceId ? like(requests.traceId, `%${input.traceId}%`) : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);
  const rows = await db
    .select({
      id: requests.id,
      apiKeyId: requests.apiKeyId,
      apiKeyLabel: apiKeys.label,
      apiKeyPrefix: apiKeys.keyPrefix,
      channelId: requests.channelId,
      channelName: channels.name,
      endpoint: requests.endpoint,
      model: requests.model,
      traceId: requests.traceId,
      status: requests.status,
      failureClass: requests.failureClass,
      httpStatus: requests.httpStatus,
      latencyMs: requests.latencyMs,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .leftJoin(apiKeys, eq(requests.apiKeyId, apiKeys.id))
    .leftJoin(channels, eq(requests.channelId, channels.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(requests.createdAt))
    .limit(input.limit ?? 20);

  return rows.map((row) => ({
    id: row.id,
    apiKeyId: row.apiKeyId,
    apiKeyLabel: row.apiKeyLabel ?? null,
    apiKeyPrefix: row.apiKeyPrefix ?? null,
    channelId: row.channelId ?? null,
    channelName: row.channelName ?? null,
    endpoint: row.endpoint as GatewayEndpoint,
    model: row.model ?? null,
    traceId: row.traceId ?? null,
    status: row.status,
    failureClass: row.failureClass ?? null,
    httpStatus: row.httpStatus ?? null,
    latencyMs: row.latencyMs ?? null,
    createdAt: row.createdAt,
  }));
}

export async function finishRequestRecord(env: WorkerEnv, input: FinishRequestRecordInput) {
  const db = getDb(env);
  const finishedAt = Date.now();

  await db
    .update(requests)
    .set({
      status: input.status,
      failureClass: input.failureClass,
      channelId: input.channelId ?? null,
      httpStatus: input.httpStatus,
      latencyMs: input.latencyMs,
      responseSize: input.responseSize,
      finishedAt,
    })
    .where(eq(requests.id, input.id));
}
