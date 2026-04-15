import { z } from 'zod';
import { gatewayEndpointSchema } from './gateway';

const analyticsCountSchema = z.number().int().nonnegative();

const successRateSchema = z.number().min(0).max(1).nullable();

export const endpointAnalyticsItemSchema = z.object({
  endpoint: gatewayEndpointSchema,
  totalRequests: analyticsCountSchema,
  completedRequests: analyticsCountSchema,
  failedRequests: analyticsCountSchema,
  rejectedRequests: analyticsCountSchema,
  avgLatencyMs: z.number().int().nullable(),
  successRate: successRateSchema,
});

export const channelAnalyticsItemSchema = z.object({
  channelId: z.string(),
  channelName: z.string().nullable(),
  totalRequests: analyticsCountSchema,
  completedRequests: analyticsCountSchema,
  failedRequests: analyticsCountSchema,
  rejectedRequests: analyticsCountSchema,
  avgLatencyMs: z.number().int().nullable(),
  successRate: successRateSchema,
});

export const analyticsSummarySchema = z.object({
  totalRequests: analyticsCountSchema,
  completedRequests: analyticsCountSchema,
  failedRequests: analyticsCountSchema,
  rejectedRequests: analyticsCountSchema,
  avgLatencyMs: z.number().int().nullable(),
  successRate: successRateSchema,
  endpointBreakdown: z.array(endpointAnalyticsItemSchema),
  channelBreakdown: z.array(channelAnalyticsItemSchema),
});

export type EndpointAnalyticsItem = z.infer<typeof endpointAnalyticsItemSchema>;
export type ChannelAnalyticsItem = z.infer<typeof channelAnalyticsItemSchema>;
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
