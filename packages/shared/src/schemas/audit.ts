import { z } from 'zod';
import { gatewayEndpointSchema, gatewayRequestStatusSchema } from './gateway';

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
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.number().int(),
});

export const auditListInputSchema = z.object({
  endpoint: gatewayEndpointSchema.optional(),
  status: gatewayRequestStatusSchema.optional(),
  apiKeyPrefix: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export type AuditRequestItem = z.infer<typeof auditRequestItemSchema>;
export type AuditListInput = z.infer<typeof auditListInputSchema>;
