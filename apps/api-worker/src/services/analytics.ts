import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { AnalyticsSummary, ChannelAnalyticsItem, EndpointAnalyticsItem } from '@uhub/shared';
import { channels, getDb, requests } from '../db/schema';
import type { WorkerEnv } from '../index';

const totalRequestsExpr = sql<number>`count(*)`.mapWith(Number);
const completedRequestsExpr = sql<number>`coalesce(sum(case when ${requests.status} = 'completed' then 1 else 0 end), 0)`.mapWith(Number);
const failedRequestsExpr = sql<number>`coalesce(sum(case when ${requests.status} = 'failed' then 1 else 0 end), 0)`.mapWith(Number);
const rejectedRequestsExpr = sql<number>`coalesce(sum(case when ${requests.status} = 'rejected' then 1 else 0 end), 0)`.mapWith(Number);
const avgLatencyMsExpr = sql<number | null>`cast(avg(${requests.latencyMs}) as integer)`;

function toNullableNumber(value: number | null) {
  return value === null ? null : Number(value);
}

function toSuccessRate(completedRequests: number, totalRequests: number) {
  if (totalRequests === 0) {
    return null;
  }

  return completedRequests / totalRequests;
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
    })
    .from(requests);
  const [endpointBreakdown, channelBreakdown] = await Promise.all([
    listEndpointAnalytics(env),
    listChannelAnalytics(env),
  ]);

  const totalRequests = overview?.totalRequests ?? 0;
  const completedRequests = overview?.completedRequests ?? 0;

  return {
    totalRequests,
    completedRequests,
    failedRequests: overview?.failedRequests ?? 0,
    rejectedRequests: overview?.rejectedRequests ?? 0,
    avgLatencyMs: toNullableNumber(overview?.avgLatencyMs ?? null),
    successRate: toSuccessRate(completedRequests, totalRequests),
    endpointBreakdown,
    channelBreakdown,
  };
}
