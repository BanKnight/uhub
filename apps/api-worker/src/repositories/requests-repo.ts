import type {
  AuditListInput,
  AuditRequestItem,
  ApiKeyUsageSummary,
  GatewayEndpoint,
  GatewayFailureClass,
  GatewayRequestStatus,
  RequestHistoryItem,
} from '@uhub/shared';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { apiKeys, channels, getDb, requests } from '../db/schema';
import type { WorkerEnv } from '../index';
import type { RequestTokenUsage } from '../services/request-log/request-log';

const MODEL_PRICING_USD_PER_MILLION_TOKENS = {
  'gpt-4o-mini': {
    input: 0.15,
    output: 0.6,
  },
  'claude-3-5-sonnet': {
    input: 3,
    output: 15,
  },
  'claude-3-5-sonnet-latest': {
    input: 3,
    output: 15,
  },
  'claude-3-5-sonnet-20241022': {
    input: 3,
    output: 15,
  },
  'claude-3-5-sonnet-20240620': {
    input: 3,
    output: 15,
  },
  'gemini-2.5-flash': {
    input: 0.3,
    output: 2.5,
  },
} as const;

type ModelPricing =
  (typeof MODEL_PRICING_USD_PER_MILLION_TOKENS)[keyof typeof MODEL_PRICING_USD_PER_MILLION_TOKENS];

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
  usage: RequestTokenUsage | null;
};

type TokenUsageAggregateRow = {
  availableCount: number;
  unavailableCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  totalCostMicros: number | null;
};

type RequestHistoryRow = {
  id: string;
  endpoint: string;
  model: string | null;
  channelId: string | null;
  channelName: string | null;
  provider: string | null;
  traceId: string | null;
  status: GatewayRequestStatus;
  failureClass: GatewayFailureClass | null;
  httpStatus: number | null;
  latencyMs: number | null;
  requestSize: number | null;
  responseSize: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  totalCostMicros: number | null;
  tokenUsageAvailability: RequestHistoryItem['tokenUsageAvailability'];
  startedAt: number;
  finishedAt: number | null;
  createdAt: number;
};

function toPricingMicros(inputTokens: number, outputTokens: number, pricing: ModelPricing) {
  return Math.round(inputTokens * pricing.input + outputTokens * pricing.output);
}

function toTotalCostMicros(model: string | null, usage: RequestTokenUsage) {
  if (model === null || usage.tokenUsageAvailability !== 'available') {
    return null;
  }

  const pricing =
    MODEL_PRICING_USD_PER_MILLION_TOKENS[
      model as keyof typeof MODEL_PRICING_USD_PER_MILLION_TOKENS
    ];

  if (!pricing || usage.inputTokens === null || usage.outputTokens === null) {
    return null;
  }

  return toPricingMicros(usage.inputTokens, usage.outputTokens, pricing);
}

function toSummaryTokenUsageAvailability(row: TokenUsageAggregateRow) {
  if (row.availableCount === 0) {
    return 'unavailable' as const;
  }

  if (row.unavailableCount === 0) {
    return 'available' as const;
  }

  return 'partial' as const;
}

export function toRequestTokenUsage(
  usage:
    | {
        inputTokens?: number | null;
        outputTokens?: number | null;
        totalTokens?: number | null;
      }
    | null
    | undefined
): RequestTokenUsage {
  const inputTokens = usage?.inputTokens ?? null;
  const outputTokens = usage?.outputTokens ?? null;
  const totalTokens = usage?.totalTokens ?? null;
  const allPresent = inputTokens !== null && outputTokens !== null && totalTokens !== null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    tokenUsageAvailability: allPresent ? 'available' : 'unavailable',
  };
}

function mapRequestRowToHistoryItem(row: RequestHistoryRow): RequestHistoryItem {
  return {
    id: row.id,
    endpoint: row.endpoint as GatewayEndpoint,
    model: row.model ?? null,
    channelId: row.channelId ?? null,
    channelName: row.channelName ?? null,
    provider: row.provider === null ? null : (row.provider as RequestHistoryItem['provider']),
    traceId: row.traceId ?? null,
    status: row.status,
    failureClass: row.failureClass ?? null,
    httpStatus: row.httpStatus ?? null,
    latencyMs: row.latencyMs ?? null,
    requestSize: row.requestSize ?? null,
    responseSize: row.responseSize ?? null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    totalTokens: row.totalTokens ?? null,
    totalCostMicros: row.totalCostMicros ?? null,
    tokenUsageAvailability: row.tokenUsageAvailability,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
  };
}

function toApiKeyUsageSummary(input: {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  rejectedRequests: number;
  lastUsedAt: number | null;
  requestLimit: number | null;
  tokenUsage: TokenUsageAggregateRow;
}): ApiKeyUsageSummary {
  const inputTokens =
    input.tokenUsage.availableCount > 0 ? (input.tokenUsage.inputTokens ?? 0) : null;
  const outputTokens =
    input.tokenUsage.availableCount > 0 ? (input.tokenUsage.outputTokens ?? 0) : null;
  const totalTokens =
    input.tokenUsage.availableCount > 0 ? (input.tokenUsage.totalTokens ?? 0) : null;
  const totalCostMicros =
    input.tokenUsage.totalCostMicros === null ? null : Number(input.tokenUsage.totalCostMicros);
  const tokenUsageAvailability = toSummaryTokenUsageAvailability(input.tokenUsage);
  const quotaLimit = input.requestLimit;
  const quotaUsed = input.totalRequests;
  const quotaRemaining =
    input.requestLimit === null ? null : Math.max(input.requestLimit - input.totalRequests, 0);

  return {
    totalRequests: input.totalRequests,
    successRequests: input.successRequests,
    failedRequests: input.failedRequests,
    rejectedRequests: input.rejectedRequests,
    inputTokens,
    outputTokens,
    totalTokens,
    totalCostMicros,
    tokenUsageAvailability,
    lastUsedAt: input.lastUsedAt,
    quotaLimit,
    quotaUsed,
    quotaRemaining,
    tokens: {
      inputTokens,
      outputTokens,
      totalTokens,
      tokenUsageAvailability,
    },
    cost: {
      totalCostMicros,
    },
    quota: {
      quotaLimit,
      quotaUsed,
      quotaRemaining,
    },
  };
}

async function getTokenUsageAggregate(
  env: WorkerEnv,
  apiKeyId: string
): Promise<TokenUsageAggregateRow> {
  const db = getDb(env);
  const row = await db
    .select({
      availableCount:
        sql<number>`coalesce(sum(case when ${requests.tokenUsageAvailability} = 'available' then 1 else 0 end), 0)`.mapWith(
          Number
        ),
      unavailableCount:
        sql<number>`coalesce(sum(case when ${requests.tokenUsageAvailability} = 'unavailable' then 1 else 0 end), 0)`.mapWith(
          Number
        ),
      inputTokens: sql<number | null>`sum(${requests.inputTokens})`,
      outputTokens: sql<number | null>`sum(${requests.outputTokens})`,
      totalTokens: sql<number | null>`sum(${requests.totalTokens})`,
      totalCostMicros: sql<number | null>`sum(${requests.totalCostMicros})`,
    })
    .from(requests)
    .where(eq(requests.apiKeyId, apiKeyId))
    .get();

  return {
    availableCount: row?.availableCount ?? 0,
    unavailableCount: row?.unavailableCount ?? 0,
    inputTokens: row?.inputTokens === null ? null : Number(row?.inputTokens),
    outputTokens: row?.outputTokens === null ? null : Number(row?.outputTokens),
    totalTokens: row?.totalTokens === null ? null : Number(row?.totalTokens),
    totalCostMicros: row?.totalCostMicros === null ? null : Number(row?.totalCostMicros),
  };
}

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
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    totalCostMicros: null,
    tokenUsageAvailability: 'unavailable',
    payloadRef: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
  });

  await db
    .update(apiKeys)
    .set({
      lastUsedAt: now,
    })
    .where(eq(apiKeys.id, input.apiKeyId));

  return { id, startedAt: now };
}

export async function listRequestsByApiKey(
  env: WorkerEnv,
  apiKeyId: string
): Promise<RequestHistoryItem[]> {
  const db = getDb(env);
  const rows = await db
    .select({
      id: requests.id,
      endpoint: requests.endpoint,
      model: requests.model,
      channelId: requests.channelId,
      channelName: channels.name,
      provider: channels.provider,
      traceId: requests.traceId,
      status: requests.status,
      failureClass: requests.failureClass,
      httpStatus: requests.httpStatus,
      latencyMs: requests.latencyMs,
      requestSize: requests.requestSize,
      responseSize: requests.responseSize,
      inputTokens: requests.inputTokens,
      outputTokens: requests.outputTokens,
      totalTokens: requests.totalTokens,
      totalCostMicros: requests.totalCostMicros,
      tokenUsageAvailability: requests.tokenUsageAvailability,
      startedAt: requests.startedAt,
      finishedAt: requests.finishedAt,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .leftJoin(channels, eq(requests.channelId, channels.id))
    .where(eq(requests.apiKeyId, apiKeyId))
    .orderBy(desc(requests.createdAt))
    .limit(20);

  return rows.map(mapRequestRowToHistoryItem);
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
      provider: channels.provider,
      endpoint: requests.endpoint,
      model: requests.model,
      traceId: requests.traceId,
      status: requests.status,
      failureClass: requests.failureClass,
      httpStatus: requests.httpStatus,
      latencyMs: requests.latencyMs,
      inputTokens: requests.inputTokens,
      outputTokens: requests.outputTokens,
      totalTokens: requests.totalTokens,
      totalCostMicros: requests.totalCostMicros,
      tokenUsageAvailability: requests.tokenUsageAvailability,
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
    provider: row.provider === null ? null : (row.provider as AuditRequestItem['provider']),
    endpoint: row.endpoint as GatewayEndpoint,
    model: row.model ?? null,
    traceId: row.traceId ?? null,
    status: row.status,
    failureClass: row.failureClass ?? null,
    httpStatus: row.httpStatus ?? null,
    latencyMs: row.latencyMs ?? null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    totalTokens: row.totalTokens ?? null,
    totalCostMicros: row.totalCostMicros ?? null,
    tokenUsageAvailability: row.tokenUsageAvailability,
    createdAt: row.createdAt,
  }));
}

export async function getApiKeyUsageSummaryRow(
  env: WorkerEnv,
  apiKeyId: string
): Promise<ApiKeyUsageSummary> {
  const db = getDb(env);
  const [apiKey, overview, tokenUsage] = await Promise.all([
    db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get(),
    db
      .select({
        totalRequests: sql<number>`count(*)`.mapWith(Number),
        successRequests:
          sql<number>`coalesce(sum(case when ${requests.status} = 'completed' then 1 else 0 end), 0)`.mapWith(
            Number
          ),
        failedRequests:
          sql<number>`coalesce(sum(case when ${requests.status} = 'failed' then 1 else 0 end), 0)`.mapWith(
            Number
          ),
        rejectedRequests:
          sql<number>`coalesce(sum(case when ${requests.status} = 'rejected' then 1 else 0 end), 0)`.mapWith(
            Number
          ),
        lastUsedAt: sql<number | null>`max(${requests.createdAt})`,
      })
      .from(requests)
      .where(eq(requests.apiKeyId, apiKeyId))
      .get(),
    getTokenUsageAggregate(env, apiKeyId),
  ]);

  const totalRequests = overview?.totalRequests ?? 0;
  const requestLimit = apiKey?.requestQuotaLimit ?? null;
  const lastUsedAt = overview?.lastUsedAt === null ? null : Number(overview?.lastUsedAt ?? null);

  return toApiKeyUsageSummary({
    totalRequests,
    successRequests: overview?.successRequests ?? 0,
    failedRequests: overview?.failedRequests ?? 0,
    rejectedRequests: overview?.rejectedRequests ?? 0,
    lastUsedAt,
    requestLimit,
    tokenUsage,
  });
}

export async function finishRequestRecord(env: WorkerEnv, input: FinishRequestRecordInput) {
  const db = getDb(env);
  const finishedAt = Date.now();
  const usage = input.usage ?? toRequestTokenUsage(null);
  const requestRecord = await db
    .select({
      model: requests.model,
    })
    .from(requests)
    .where(eq(requests.id, input.id))
    .get();
  const totalCostMicros = toTotalCostMicros(requestRecord?.model ?? null, usage);

  await db
    .update(requests)
    .set({
      status: input.status,
      failureClass: input.failureClass,
      channelId: input.channelId ?? null,
      httpStatus: input.httpStatus,
      latencyMs: input.latencyMs,
      responseSize: input.responseSize,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      totalCostMicros,
      tokenUsageAvailability: usage.tokenUsageAvailability,
      finishedAt,
    })
    .where(eq(requests.id, input.id));
}
