import { createChannelInputSchema, updateChannelInputSchema, updateChannelStatusInputSchema } from '@uhub/shared';
import { adminProcedure, createRouter } from '../../lib/trpc';
import { createChannel, listChannels, updateChannel, updateChannelStatus } from '../../services/channels';

export const channelsRouter = createRouter({
  list: adminProcedure.query(({ ctx }) => listChannels(ctx.env)),
  create: adminProcedure.input(createChannelInputSchema).mutation(({ ctx, input }) => createChannel(ctx.env, input)),
  update: adminProcedure.input(updateChannelInputSchema).mutation(({ ctx, input }) => updateChannel(ctx.env, input)),
  status: adminProcedure
    .input(updateChannelStatusInputSchema)
    .mutation(({ ctx, input }) => updateChannelStatus(ctx.env, input)),
});
