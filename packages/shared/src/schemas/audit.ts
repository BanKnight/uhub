import { z } from 'zod';
import {
  gatewayEndpointSchema,
  gatewayFailureClassSchema,
  gatewayRequestStatusSchema,
} from './gateway';
import { requestTokenUsageAvailabilitySchema } from './api-keys';

export const auditRequestItemSchema = z.object({
  id: z.string(),
  apiKeyId: z.string(),
  apiKeyLabel: z.string().nullable(),
  apiKeyPrefix: z.string().nullable(),
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
  endpoint: gatewayEndpointSchema,
  model: z.string().nullable(),
  traceId: z.string().nullable(),
  status: gatewayRequestStatusSchema,
  failureClass: gatewayFailureClassSchema.nullable(),
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  tokenUsageAvailability: requestTokenUsageAvailabilitySchema,
  createdAt: z.number().int(),
});

export const auditListInputSchema = z.object({
  endpoint: gatewayEndpointSchema.optional(),
  status: gatewayRequestStatusSchema.optional(),
  failureClass: gatewayFailureClassSchema.optional(),
  apiKeyPrefix: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type AuditRequestItem = z.infer<typeof auditRequestItemSchema>;
export type AuditListInput = z.infer<typeof auditListInputSchema>;
