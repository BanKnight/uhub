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

export type AuditRequestItem = z.infer<typeof auditRequestItemSchema>;
