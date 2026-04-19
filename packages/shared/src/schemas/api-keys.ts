import { z } from 'zod';

export const apiKeyStatusSchema = z.enum(['active', 'disabled', 'expired', 'revoked']);
export const endpointRuleSchema = z.enum([
  'openai_chat_completions',
  'anthropic_messages',
  'gemini_contents',
]);

const usageCountSchema = z.number().int().nonnegative();
const nullableUsageMetricSchema = z.number().nullable();
export const requestTokenUsageAvailabilitySchema = z.enum(['available', 'unavailable']);
export const summaryTokenUsageAvailabilitySchema = z.enum(['available', 'partial', 'unavailable']);

export const apiKeyQuotaSchema = z.object({
  requestLimit: z.number().int().positive().nullable(),
});

export const apiKeyUsageSummarySchema = z.object({
  totalRequests: usageCountSchema,
  successRequests: usageCountSchema,
  failedRequests: usageCountSchema,
  rejectedRequests: usageCountSchema,
  inputTokens: nullableUsageMetricSchema,
  outputTokens: nullableUsageMetricSchema,
  totalTokens: nullableUsageMetricSchema,
  tokenUsageAvailability: summaryTokenUsageAvailabilitySchema,
  lastUsedAt: z.number().nullable(),
  quotaLimit: nullableUsageMetricSchema,
  quotaUsed: nullableUsageMetricSchema,
  quotaRemaining: nullableUsageMetricSchema,
});

export const apiKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  keyPrefix: z.string(),
  status: apiKeyStatusSchema,
  expiresAt: z.number().nullable(),
  maxConcurrency: z.number().int().positive(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  channelIds: z.array(z.string()),
  endpointRules: z.array(endpointRuleSchema),
  quota: apiKeyQuotaSchema,
});

export const portalOverviewSchema = z.object({
  apiKey: apiKeySchema,
  usage: apiKeyUsageSummarySchema,
});

export const createApiKeyInputSchema = z.object({
  label: z.string().min(1),
  channelIds: z.array(z.string().min(1)).min(1),
  endpointRules: z.array(endpointRuleSchema).min(1),
  maxConcurrency: z.number().int().positive(),
  expiresAt: z.number().int().positive().nullable().optional(),
  quota: apiKeyQuotaSchema.optional(),
});

export const createApiKeyResultSchema = z.object({
  rawKey: z.string(),
  apiKey: apiKeySchema,
});

export const revokeApiKeyInputSchema = z.object({
  id: z.string().min(1),
});

export const rotateApiKeyInputSchema = z.object({
  id: z.string().min(1),
});

export const portalExchangeInputSchema = z.object({
  rawKey: z.string().min(1),
});

export const portalExchangeResultSchema = z.object({
  sessionId: z.string(),
  apiKeyId: z.string(),
  label: z.string(),
  expiresAt: z.number(),
});

export type ApiKeyQuota = z.infer<typeof apiKeyQuotaSchema>;
export type ApiKeyUsageSummary = z.infer<typeof apiKeyUsageSummarySchema>;
export type ApiKey = z.infer<typeof apiKeySchema>;
export type PortalOverview = z.infer<typeof portalOverviewSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;
export type CreateApiKeyResult = z.infer<typeof createApiKeyResultSchema>;
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeyInputSchema>;
export type RotateApiKeyInput = z.infer<typeof rotateApiKeyInputSchema>;
export type PortalExchangeInput = z.infer<typeof portalExchangeInputSchema>;
export type PortalExchangeResult = z.infer<typeof portalExchangeResultSchema>;
