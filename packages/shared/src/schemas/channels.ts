import { z } from 'zod';

export const channelProviderSchema = z.enum(['openai', 'anthropic', 'gemini']);
export const channelStatusSchema = z.enum(['active', 'disabled']);
export const channelProtocolSchema = z.enum([
  'openai_chat_completions',
  'anthropic_messages',
  'gemini_contents',
]);
export const gatewayChannelHealthStatusSchema = z.enum(['healthy', 'cooling_down']);

export type ChannelProvider = z.infer<typeof channelProviderSchema>;
export type ChannelProtocol = z.infer<typeof channelProtocolSchema>;

export const channelProviderProtocolMap: Record<ChannelProvider, ChannelProtocol> = {
  openai: 'openai_chat_completions',
  anthropic: 'anthropic_messages',
  gemini: 'gemini_contents',
};

export const channelProviderDefaultBaseUrlMap: Record<ChannelProvider, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

export const channelProviderRecommendedModels: Record<ChannelProvider, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o'],
  anthropic: [
    'claude-3-5-sonnet-latest',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-20240620',
  ],
  gemini: ['gemini-2.5-flash'],
};

function assertChannelProviderProtocol(
  input: { provider: ChannelProvider; protocol: ChannelProtocol },
  ctx: z.RefinementCtx
) {
  if (channelProviderProtocolMap[input.provider] === input.protocol) {
    return;
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['protocol'],
    message: `Protocol ${input.protocol} is incompatible with provider ${input.provider}`,
  });
}

function assertDefaultTestModelInModels(
  input: { models: string[]; defaultTestModel: string | null },
  ctx: z.RefinementCtx
) {
  if (input.defaultTestModel === null) {
    return;
  }

  if (input.models.includes(input.defaultTestModel)) {
    return;
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['defaultTestModel'],
    message: 'defaultTestModel must be included in models',
  });
}

export const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: channelProviderSchema,
  protocol: channelProtocolSchema,
  baseUrl: z.string(),
  models: z.array(z.string()),
  defaultTestModel: z.string().nullable(),
  status: channelStatusSchema,
  gatewayHealthStatus: gatewayChannelHealthStatusSchema,
  gatewayUnhealthyUntil: z.number().int().nullable(),
  configJson: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const channelSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: channelProviderSchema,
  models: z.array(z.string()),
  status: channelStatusSchema,
});

const baseChannelInputSchema = z.object({
  name: z.string().min(1),
  provider: channelProviderSchema,
  protocol: channelProtocolSchema,
  baseUrl: z.string().url(),
  models: z.array(z.string().min(1)).default([]),
  defaultTestModel: z.string().nullable().default(null),
  status: channelStatusSchema.default('active'),
});

export const createChannelInputSchema = baseChannelInputSchema.superRefine((input, ctx) => {
  assertChannelProviderProtocol(input, ctx);
  assertDefaultTestModelInModels(input, ctx);
});

export const updateChannelInputSchema = baseChannelInputSchema
  .extend({
    id: z.string().min(1),
  })
  .superRefine((input, ctx) => {
    assertChannelProviderProtocol(input, ctx);
  });

export const updateChannelStatusInputSchema = z.object({
  id: z.string().min(1),
  status: channelStatusSchema,
});

export type Channel = z.infer<typeof channelSchema>;
export type ChannelSummary = z.infer<typeof channelSummarySchema>;
export type CreateChannelInput = z.infer<typeof createChannelInputSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelInputSchema>;
export type UpdateChannelStatusInput = z.infer<typeof updateChannelStatusInputSchema>;
