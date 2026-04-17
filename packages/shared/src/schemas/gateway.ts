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

export const anthropicMessageRoleSchema = z.enum(['user', 'assistant']);

export const anthropicTextBlockInputSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
});

export const anthropicImageBlockInputSchema = z.object({
  type: z.literal('image'),
  source: z.object({
    type: z.literal('base64'),
    media_type: z.string().min(1),
    data: z.string().min(1),
  }),
});

export const anthropicDocumentBlockInputSchema = z.object({
  type: z.literal('document'),
  source: z.union([
    z.object({
      type: z.literal('base64'),
      media_type: z.string().min(1),
      data: z.string().min(1),
    }),
    z.object({
      type: z.literal('text'),
      text: z.string().min(1),
    }),
  ]),
});

export const anthropicToolUseBlockInputSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});

export const anthropicToolResultContentBlockSchema = z.union([
  anthropicTextBlockInputSchema,
  anthropicImageBlockInputSchema,
  anthropicDocumentBlockInputSchema,
]);

export const anthropicToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: z.union([z.string().min(1), z.array(anthropicToolResultContentBlockSchema).min(1)]),
});

export const anthropicMessageContentBlockSchema = z.union([
  anthropicTextBlockInputSchema,
  anthropicImageBlockInputSchema,
  anthropicDocumentBlockInputSchema,
  anthropicToolUseBlockInputSchema,
  anthropicToolResultBlockSchema,
]);

export const anthropicMessageSchema = z.object({
  role: anthropicMessageRoleSchema,
  content: z.union([z.string().min(1), z.array(anthropicMessageContentBlockSchema).min(1)]),
});

export const anthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(anthropicMessageSchema).min(1),
  max_tokens: z.number().int().positive(),
  system: z.union([z.string().min(1), z.array(anthropicTextBlockInputSchema).min(1)]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  stop_sequences: z.array(z.string().min(1)).max(4).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  stream: z.boolean().optional(),
});

export const gatewayRequestStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'rejected',
]);

export const gatewayFailureClassSchema = z.enum([
  'invalid_request',
  'auth_error',
  'upstream_error',
  'upstream_timeout',
  'network_error',
]);

export const gatewayErrorSchema = z.object({
  error: z.object({
    type: gatewayFailureClassSchema,
    message: z.string(),
    traceId: z.string(),
    upstreamStatus: z.number().int().nullable(),
  }),
});

export const requestHistoryItemSchema = z.object({
  id: z.string(),
  endpoint: gatewayEndpointSchema,
  model: z.string().nullable(),
  channelId: z.string().nullable(),
  traceId: z.string().nullable(),
  status: gatewayRequestStatusSchema,
  failureClass: gatewayFailureClassSchema.nullable(),
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  requestSize: z.number().int().nullable(),
  responseSize: z.number().int().nullable(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});

export const chatCompletionToolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

export const chatCompletionChoiceSchema = z.object({
  index: z.number().int(),
  message: z.object({
    role: z.literal('assistant'),
    content: z.string().nullable().optional(),
    toolCalls: z.array(chatCompletionToolCallSchema).optional(),
    tool_calls: z.array(chatCompletionToolCallSchema).optional(),
  }),
  finishReason: z.string().nullable().optional(),
  finish_reason: z.string().nullable().optional(),
});

export const chatCompletionsResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(chatCompletionChoiceSchema),
});

export const anthropicTextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const anthropicToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});

export const anthropicResponseContentBlockSchema = z.union([
  anthropicTextBlockSchema,
  anthropicToolUseBlockSchema,
]);

export const anthropicUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

export const anthropicMessagesResponseSchema = z.object({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  model: z.string(),
  content: z.array(anthropicResponseContentBlockSchema),
  stop_reason: z.string().nullable(),
  stop_sequence: z.string().nullable(),
  usage: anthropicUsageSchema,
});

export type GatewayEndpoint = z.infer<typeof gatewayEndpointSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatCompletionsRequest = z.infer<typeof chatCompletionsRequestSchema>;
export type AnthropicMessage = z.infer<typeof anthropicMessageSchema>;
export type AnthropicMessagesRequest = z.infer<typeof anthropicMessagesRequestSchema>;
export type GatewayRequestStatus = z.infer<typeof gatewayRequestStatusSchema>;
export type GatewayFailureClass = z.infer<typeof gatewayFailureClassSchema>;
export type RequestHistoryItem = z.infer<typeof requestHistoryItemSchema>;
export type ChatCompletionsResponse = z.infer<typeof chatCompletionsResponseSchema>;
export type AnthropicUsage = z.infer<typeof anthropicUsageSchema>;
export type AnthropicMessagesResponse = z.infer<typeof anthropicMessagesResponseSchema>;
export type GatewayError = z.infer<typeof gatewayErrorSchema>;
