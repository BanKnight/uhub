import { z } from 'zod';
import { gatewayEndpointSchema } from './gateway';
import { summaryTokenUsageAvailabilitySchema } from './api-keys';
import { channelProviderSchema } from './channels';

const analyticsCountSchema = z.number().int().nonnegative();

const successRateSchema = z.number().min(0).max(1).nullable();
const nullableTokenMetricSchema = z.number().int().nonnegative().nullable();

export const endpointAnalyticsItemSchema = z.object({
  endpoint: gatewayEndpointSchema,
  totalRequests: analyticsCountSchema,
  completedRequests: analyticsCountSchema,
  failedRequests: analyticsCountSchema,
  rejectedRequests: analyticsCountSchema,
  avgLatencyMs: z.number().int().nullable(),
  successRate: successRateSchema,
  inputTokens: nullableTokenMetricSchema,
  outputTokens: nullableTokenMetricSchema,
  totalTokens: nullableTokenMetricSchema,
  tokenUsageAvailability: summaryTokenUsageAvailabilitySchema,
});

export const channelAnalyticsItemSchema = z.object({
  channelId: z.string(),
  channelName: z.string().nullable(),
  provider: channelProviderSchema.nullable(),
  totalRequests: analyticsCountSchema,
  completedRequests: analyticsCountSchema,
  failedRequests: analyticsCountSchema,
  rejectedRequests: analyticsCountSchema,
  avgLatencyMs: z.number().int().nullable(),
  successRate: successRateSchema,
  inputTokens: nullableTokenMetricSchema,
  outputTokens: nullableTokenMetricSchema,
  totalTokens: nullableTokenMetricSchema,
  tokenUsageAvailability: summaryTokenUsageAvailabilitySchema,
});

export const analyticsSummarySchema = z.object({
  totalRequests: analyticsCountSchema,
  completedRequests: analyticsCountSchema,
  failedRequests: analyticsCountSchema,
  rejectedRequests: analyticsCountSchema,
  avgLatencyMs: z.number().int().nullable(),
  successRate: successRateSchema,
  inputTokens: nullableTokenMetricSchema,
  outputTokens: nullableTokenMetricSchema,
  totalTokens: nullableTokenMetricSchema,
  tokenUsageAvailability: summaryTokenUsageAvailabilitySchema,
  endpointBreakdown: z.array(endpointAnalyticsItemSchema),
  channelBreakdown: z.array(channelAnalyticsItemSchema),
});

export type EndpointAnalyticsItem = z.infer<typeof endpointAnalyticsItemSchema>;
export type ChannelAnalyticsItem = z.infer<typeof channelAnalyticsItemSchema>;
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
