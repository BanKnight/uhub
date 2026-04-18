import { z } from 'zod';

export const channelStatusSchema = z.enum(['active', 'disabled']);
export const channelProtocolSchema = z.enum([
  'openai_chat_completions',
  'anthropic_messages',
  'gemini_contents',
]);

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

export const createChannelInputSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  protocol: channelProtocolSchema,
  baseUrl: z.string().url(),
  models: z.array(z.string().min(1)).default([]),
  status: channelStatusSchema.default('active'),
  configJson: z.string().default('{}'),
});

export const updateChannelInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  protocol: channelProtocolSchema,
  baseUrl: z.string().url(),
  models: z.array(z.string().min(1)),
  status: channelStatusSchema,
  configJson: z.string(),
});

export const updateChannelStatusInputSchema = z.object({
  id: z.string().min(1),
  status: channelStatusSchema,
});

export type ChannelProtocol = z.infer<typeof channelProtocolSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type CreateChannelInput = z.infer<typeof createChannelInputSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelInputSchema>;
export type UpdateChannelStatusInput = z.infer<typeof updateChannelStatusInputSchema>;
