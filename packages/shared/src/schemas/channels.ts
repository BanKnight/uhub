import { z } from 'zod';

export const channelStatusSchema = z.enum(['active', 'disabled']);

export const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  baseUrl: z.string(),
  status: channelStatusSchema,
  configJson: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const createChannelInputSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  baseUrl: z.string().url(),
  status: channelStatusSchema.default('active'),
  configJson: z.string().default('{}'),
});

export const updateChannelInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  baseUrl: z.string().url(),
  status: channelStatusSchema,
  configJson: z.string(),
});

export const updateChannelStatusInputSchema = z.object({
  id: z.string().min(1),
  status: channelStatusSchema,
});

export type Channel = z.infer<typeof channelSchema>;
export type CreateChannelInput = z.infer<typeof createChannelInputSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelInputSchema>;
export type UpdateChannelStatusInput = z.infer<typeof updateChannelStatusInputSchema>;
