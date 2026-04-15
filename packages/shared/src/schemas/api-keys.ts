import { z } from 'zod';

export const apiKeyStatusSchema = z.enum(['active', 'disabled', 'expired', 'revoked']);
export const endpointRuleSchema = z.enum(['openai_chat_completions']);

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
});

export const createApiKeyInputSchema = z.object({
  label: z.string().min(1),
  channelIds: z.array(z.string().min(1)).min(1),
  endpointRules: z.array(endpointRuleSchema).min(1),
  maxConcurrency: z.number().int().positive(),
  expiresAt: z.number().int().positive().nullable().optional(),
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

export type ApiKey = z.infer<typeof apiKeySchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;
export type CreateApiKeyResult = z.infer<typeof createApiKeyResultSchema>;
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeyInputSchema>;
export type RotateApiKeyInput = z.infer<typeof rotateApiKeyInputSchema>;
export type PortalExchangeInput = z.infer<typeof portalExchangeInputSchema>;
export type PortalExchangeResult = z.infer<typeof portalExchangeResultSchema>;
