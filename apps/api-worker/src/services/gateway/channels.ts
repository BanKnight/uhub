import { inArray } from "drizzle-orm";
import { channels, getDb } from "../../db/schema";
import type { WorkerEnv } from "../../index";

const CHANNEL_UNHEALTHY_COOLDOWN_MS = 30_000;
const channelUnhealthyUntil = new Map<string, number>();

export type GatewayChannel = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
};

function isChannelCoolingDown(channelId: string, now = Date.now()) {
  const unhealthyUntil = channelUnhealthyUntil.get(channelId);

  if (!unhealthyUntil) {
    return false;
  }

  if (unhealthyUntil <= now) {
    channelUnhealthyUntil.delete(channelId);
    return false;
  }

  return true;
}

export function markGatewayChannelHealthy(channelId: string) {
  channelUnhealthyUntil.delete(channelId);
}

export function markGatewayChannelUnhealthy(
  channelId: string,
  cooldownMs = CHANNEL_UNHEALTHY_COOLDOWN_MS,
) {
  channelUnhealthyUntil.set(channelId, Date.now() + cooldownMs);
}

export async function listActiveGatewayChannels(
  env: WorkerEnv,
  channelIds: string[],
): Promise<GatewayChannel[]> {
  const uniqueChannelIds = [...new Set(channelIds)];
  const db = getDb(env);
  const rows = await db
    .select()
    .from(channels)
    .where(inArray(channels.id, uniqueChannelIds));

  const activeChannelsById = new Map(
    rows
      .filter((channel) => channel.status === "active")
      .map((channel) => [
        channel.id,
        {
          id: channel.id,
          name: channel.name,
          provider: channel.provider,
          baseUrl: channel.baseUrl,
        } satisfies GatewayChannel,
      ]),
  );

  return uniqueChannelIds
    .map((channelId) => activeChannelsById.get(channelId) ?? null)
    .filter((channel): channel is GatewayChannel => channel !== null);
}

export async function requireActiveGatewayChannels(
  env: WorkerEnv,
  channelIds: string[],
): Promise<GatewayChannel[]> {
  const activeChannels = await listActiveGatewayChannels(env, channelIds);

  if (activeChannels.length === 0) {
    throw new Response(
      JSON.stringify({ error: "Allowed channels are not active" }),
      { status: 403 },
    );
  }

  return activeChannels;
}

export function prioritizeGatewayChannels(channels: GatewayChannel[]) {
  const now = Date.now();

  return [...channels].sort((left, right) => {
    const leftCoolingDown = isChannelCoolingDown(left.id, now);
    const rightCoolingDown = isChannelCoolingDown(right.id, now);

    if (leftCoolingDown === rightCoolingDown) {
      return 0;
    }

    return leftCoolingDown ? 1 : -1;
  });
}
