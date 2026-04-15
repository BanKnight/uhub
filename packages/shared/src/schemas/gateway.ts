import { z } from 'zod';
import { endpointRuleSchema } from './api-keys';

export const gatewayEndpointSchema = endpointRuleSchema;

export const chatMessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export const chatMessageSchema = z.object({
  role: chatMessageRoleSchema,
  content: z.string().min(1),
});

export const chatCompletionsRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(chatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

export const gatewayRequestStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'rejected']);

export const requestHistoryItemSchema = z.object({
  id: z.string(),
  endpoint: gatewayEndpointSchema,
  model: z.string().nullable(),
  channelId: z.string().nullable(),
  traceId: z.string().nullable(),
  status: gatewayRequestStatusSchema,
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  requestSize: z.number().int().nullable(),
  responseSize: z.number().int().nullable(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});

export const chatCompletionChoiceSchema = z.object({
  index: z.number().int(),
  message: z.object({
    role: z.literal('assistant'),
    content: z.string(),
  }),
  finishReason: z.string().nullable(),
});

export const chatCompletionsResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(chatCompletionChoiceSchema),
});

export type GatewayEndpoint = z.infer<typeof gatewayEndpointSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatCompletionsRequest = z.infer<typeof chatCompletionsRequestSchema>;
export type GatewayRequestStatus = z.infer<typeof gatewayRequestStatusSchema>;
export type RequestHistoryItem = z.infer<typeof requestHistoryItemSchema>;
export type ChatCompletionsResponse = z.infer<typeof chatCompletionsResponseSchema>;
