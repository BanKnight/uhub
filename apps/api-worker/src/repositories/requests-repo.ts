import { desc, eq } from 'drizzle-orm';
import type { GatewayEndpoint, GatewayRequestStatus, RequestHistoryItem } from '@uhub/shared';
import { getDb, requests } from '../db/schema';
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
  httpStatus: number;
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

export async function listRequestsByApiKey(env: WorkerEnv, apiKeyId: string): Promise<RequestHistoryItem[]> {
  const db = getDb(env);
  const rows = await db.select().from(requests).where(eq(requests.apiKeyId, apiKeyId)).orderBy(desc(requests.createdAt)).limit(20);

  return rows.map((row) => ({
    id: row.id,
    endpoint: row.endpoint as GatewayEndpoint,
    model: row.model ?? null,
    channelId: row.channelId ?? null,
    traceId: row.traceId ?? null,
    status: row.status,
    httpStatus: row.httpStatus ?? null,
    latencyMs: row.latencyMs ?? null,
    requestSize: row.requestSize ?? null,
    responseSize: row.responseSize ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
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
      httpStatus: input.httpStatus,
      latencyMs: input.latencyMs,
      responseSize: input.responseSize,
      finishedAt,
    })
    .where(eq(requests.id, input.id));
}
