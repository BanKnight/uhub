import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { AnalyticsSummary, ChannelAnalyticsItem, EndpointAnalyticsItem } from '@uhub/shared';
import { channels, getDb, requests } from '../db/schema';
import type { WorkerEnv } from '../index';

const totalRequestsExpr = sql<number>`count(*)`.mapWith(Number);
const completedRequestsExpr =
  sql<number>`coalesce(sum(case when ${requests.status} = 'completed' then 1 else 0 end), 0)`.mapWith(
    Number
  );
const failedRequestsExpr =
  sql<number>`coalesce(sum(case when ${requests.status} = 'failed' then 1 else 0 end), 0)`.mapWith(
    Number
  );
const rejectedRequestsExpr =
  sql<number>`coalesce(sum(case when ${requests.status} = 'rejected' then 1 else 0 end), 0)`.mapWith(
    Number
  );
const avgLatencyMsExpr = sql<number | null>`cast(avg(${requests.latencyMs}) as integer)`;
const availableCountExpr =
  sql<number>`coalesce(sum(case when ${requests.tokenUsageAvailability} = 'available' then 1 else 0 end), 0)`.mapWith(
    Number
  );
const unavailableCountExpr =
  sql<number>`coalesce(sum(case when ${requests.tokenUsageAvailability} = 'unavailable' then 1 else 0 end), 0)`.mapWith(
    Number
  );
const inputTokensExpr = sql<number | null>`sum(${requests.inputTokens})`;
const outputTokensExpr = sql<number | null>`sum(${requests.outputTokens})`;
const totalTokensExpr = sql<number | null>`sum(${requests.totalTokens})`;

type AnalyticsTokenAggregateRow = {
  availableCount: number;
  unavailableCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

function toNullableNumber(value: number | null) {
  return value === null ? null : Number(value);
}

function toSuccessRate(completedRequests: number, totalRequests: number) {
  if (totalRequests === 0) {
    return null;
  }

  return completedRequests / totalRequests;
}

function toSummaryTokenUsageAvailability(row: AnalyticsTokenAggregateRow) {
  if (row.availableCount === 0) {
    return 'unavailable' as const;
  }

  if (row.unavailableCount === 0) {
    return 'available' as const;
  }

  return 'partial' as const;
}

function toAnalyticsTokenSummary(row: AnalyticsTokenAggregateRow) {
  return {
    inputTokens: row.availableCount > 0 ? (toNullableNumber(row.inputTokens) ?? 0) : null,
    outputTokens: row.availableCount > 0 ? (toNullableNumber(row.outputTokens) ?? 0) : null,
    totalTokens: row.availableCount > 0 ? (toNullableNumber(row.totalTokens) ?? 0) : null,
    tokenUsageAvailability: toSummaryTokenUsageAvailability(row),
  };
}

async function listEndpointAnalytics(env: WorkerEnv): Promise<EndpointAnalyticsItem[]> {
  const db = getDb(env);
  const rows = await db
    .select({
      endpoint: requests.endpoint,
      totalRequests: totalRequestsExpr,
      completedRequests: completedRequestsExpr,
      failedRequests: failedRequestsExpr,
      rejectedRequests: rejectedRequestsExpr,
      avgLatencyMs: avgLatencyMsExpr,
      availableCount: availableCountExpr,
      unavailableCount: unavailableCountExpr,
      inputTokens: inputTokensExpr,
      outputTokens: outputTokensExpr,
      totalTokens: totalTokensExpr,
    })
    .from(requests)
    .groupBy(requests.endpoint)
    .orderBy(desc(totalRequestsExpr));

  return rows.map((row) => ({
    endpoint: row.endpoint as EndpointAnalyticsItem['endpoint'],
    totalRequests: row.totalRequests,
    completedRequests: row.completedRequests,
    failedRequests: row.failedRequests,
    rejectedRequests: row.rejectedRequests,
    avgLatencyMs: toNullableNumber(row.avgLatencyMs),
    successRate: toSuccessRate(row.completedRequests, row.totalRequests),
    ...toAnalyticsTokenSummary(row),
  }));
}

async function listChannelAnalytics(env: WorkerEnv): Promise<ChannelAnalyticsItem[]> {
  const db = getDb(env);
  const rows = await db
    .select({
      channelId: requests.channelId,
      channelName: channels.name,
      totalRequests: totalRequestsExpr,
      completedRequests: completedRequestsExpr,
      failedRequests: failedRequestsExpr,
      rejectedRequests: rejectedRequestsExpr,
      avgLatencyMs: avgLatencyMsExpr,
      availableCount: availableCountExpr,
      unavailableCount: unavailableCountExpr,
      inputTokens: inputTokensExpr,
      outputTokens: outputTokensExpr,
      totalTokens: totalTokensExpr,
    })
    .from(requests)
    .leftJoin(channels, eq(requests.channelId, channels.id))
    .where(isNotNull(requests.channelId))
    .groupBy(requests.channelId, channels.name)
    .orderBy(desc(totalRequestsExpr));

  return rows.map((row) => ({
    channelId: row.channelId as string,
    channelName: row.channelName ?? null,
    totalRequests: row.totalRequests,
    completedRequests: row.completedRequests,
    failedRequests: row.failedRequests,
    rejectedRequests: row.rejectedRequests,
    avgLatencyMs: toNullableNumber(row.avgLatencyMs),
    successRate: toSuccessRate(row.completedRequests, row.totalRequests),
    ...toAnalyticsTokenSummary(row),
  }));
}

export async function getAnalyticsSummary(env: WorkerEnv): Promise<AnalyticsSummary> {
  const db = getDb(env);
  const [overview] = await db
    .select({
      totalRequests: totalRequestsExpr,
      completedRequests: completedRequestsExpr,
      failedRequests: failedRequestsExpr,
      rejectedRequests: rejectedRequestsExpr,
      avgLatencyMs: avgLatencyMsExpr,
      availableCount: availableCountExpr,
      unavailableCount: unavailableCountExpr,
      inputTokens: inputTokensExpr,
      outputTokens: outputTokensExpr,
      totalTokens: totalTokensExpr,
    })
    .from(requests);
  const [endpointBreakdown, channelBreakdown] = await Promise.all([
    listEndpointAnalytics(env),
    listChannelAnalytics(env),
  ]);

  const totalRequests = overview?.totalRequests ?? 0;
  const completedRequests = overview?.completedRequests ?? 0;
  const tokenSummary = toAnalyticsTokenSummary({
    availableCount: overview?.availableCount ?? 0,
    unavailableCount: overview?.unavailableCount ?? 0,
    inputTokens: overview?.inputTokens ?? null,
    outputTokens: overview?.outputTokens ?? null,
    totalTokens: overview?.totalTokens ?? null,
  });

  return {
    totalRequests,
    completedRequests,
    failedRequests: overview?.failedRequests ?? 0,
    rejectedRequests: overview?.rejectedRequests ?? 0,
    avgLatencyMs: toNullableNumber(overview?.avgLatencyMs ?? null),
    successRate: toSuccessRate(completedRequests, totalRequests),
    ...tokenSummary,
    endpointBreakdown,
    channelBreakdown,
  };
}
