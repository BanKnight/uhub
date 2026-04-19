import { z } from 'zod';

export const channelProviderSchema = z.enum(['openai', 'anthropic', 'gemini']);
export const channelStatusSchema = z.enum(['active', 'disabled']);
export const channelProtocolSchema = z.enum([
  'openai_chat_completions',
  'anthropic_messages',
  'gemini_contents',
]);

export type ChannelProvider = z.infer<typeof channelProviderSchema>;
export type ChannelProtocol = z.infer<typeof channelProtocolSchema>;

export const channelProviderProtocolMap: Record<ChannelProvider, ChannelProtocol> = {
  openai: 'openai_chat_completions',
  anthropic: 'anthropic_messages',
  gemini: 'gemini_contents',
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

export const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  protocol: channelProtocolSchema,
  baseUrl: z.string(),
  models: z.array(z.string()),
  status: channelStatusSchema,
  configJson: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const baseChannelInputSchema = z.object({
  name: z.string().min(1),
  provider: channelProviderSchema,
  protocol: channelProtocolSchema,
  baseUrl: z.string().url(),
  models: z.array(z.string().min(1)).default([]),
  status: channelStatusSchema.default('active'),
});

export const createChannelInputSchema = baseChannelInputSchema.superRefine(
  assertChannelProviderProtocol
);

export const updateChannelInputSchema = baseChannelInputSchema
  .extend({
    id: z.string().min(1),
  })
  .superRefine(assertChannelProviderProtocol);

export const updateChannelStatusInputSchema = z.object({
  id: z.string().min(1),
  status: channelStatusSchema,
});

export type Channel = z.infer<typeof channelSchema>;
export type CreateChannelInput = z.infer<typeof createChannelInputSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelInputSchema>;
export type UpdateChannelStatusInput = z.infer<typeof updateChannelStatusInputSchema>;
