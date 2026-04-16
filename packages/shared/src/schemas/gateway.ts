import { z } from "zod";
import { endpointRuleSchema } from "./api-keys";

export const gatewayEndpointSchema = endpointRuleSchema;

export const chatMessageRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool",
]);

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

export const anthropicMessageRoleSchema = z.enum(["user", "assistant"]);

export const anthropicMessageContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
});

export const anthropicMessageSchema = z.object({
  role: anthropicMessageRoleSchema,
  content: z.union([
    z.string().min(1),
    z.array(anthropicMessageContentBlockSchema).min(1),
  ]),
});

export const anthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(anthropicMessageSchema).min(1),
  max_tokens: z.number().int().positive(),
  system: z.string().min(1).optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  stop_sequences: z.array(z.string().min(1)).max(4).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  stream: z.boolean().optional(),
});

export const gatewayRequestStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "rejected",
]);

export const gatewayFailureClassSchema = z.enum([
  "invalid_request",
  "auth_error",
  "upstream_error",
  "upstream_timeout",
  "network_error",
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

export const chatCompletionChoiceSchema = z.object({
  index: z.number().int(),
  message: z.object({
    role: z.literal("assistant"),
    content: z.string(),
  }),
  finishReason: z.string().nullable(),
});

export const chatCompletionsResponseSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(chatCompletionChoiceSchema),
});

export const anthropicTextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const anthropicUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

export const anthropicMessagesResponseSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  model: z.string(),
  content: z.array(anthropicTextBlockSchema),
  stop_reason: z.string().nullable(),
  stop_sequence: z.string().nullable(),
  usage: anthropicUsageSchema,
});

export type GatewayEndpoint = z.infer<typeof gatewayEndpointSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatCompletionsRequest = z.infer<
  typeof chatCompletionsRequestSchema
>;
export type AnthropicMessage = z.infer<typeof anthropicMessageSchema>;
export type AnthropicMessagesRequest = z.infer<
  typeof anthropicMessagesRequestSchema
>;
export type GatewayRequestStatus = z.infer<typeof gatewayRequestStatusSchema>;
export type GatewayFailureClass = z.infer<typeof gatewayFailureClassSchema>;
export type RequestHistoryItem = z.infer<typeof requestHistoryItemSchema>;
export type ChatCompletionsResponse = z.infer<
  typeof chatCompletionsResponseSchema
>;
export type AnthropicUsage = z.infer<typeof anthropicUsageSchema>;
export type AnthropicMessagesResponse = z.infer<
  typeof anthropicMessagesResponseSchema
>;
export type GatewayError = z.infer<typeof gatewayErrorSchema>;
