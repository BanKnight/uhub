import { inArray } from 'drizzle-orm';
import { channels, getDb } from '../../db/schema';
import type { WorkerEnv } from '../../index';

const DEFAULT_CHANNEL_UNHEALTHY_COOLDOWN_MS = 30_000;
const channelUnhealthyUntil = new Map<string, number>();

export type GatewayChannel = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
};

export type GatewayChannelHealthSnapshot = {
  gatewayHealthStatus: 'healthy' | 'cooling_down';
  gatewayUnhealthyUntil: number | null;
};

export function getGatewayChannelHealthSnapshot(
  channelId: string,
  now = Date.now()
): GatewayChannelHealthSnapshot {
  const unhealthyUntil = channelUnhealthyUntil.get(channelId);

  if (!unhealthyUntil) {
    return {
      gatewayHealthStatus: 'healthy',
      gatewayUnhealthyUntil: null,
    };
  }

  if (unhealthyUntil <= now) {
    channelUnhealthyUntil.delete(channelId);
    return {
      gatewayHealthStatus: 'healthy',
      gatewayUnhealthyUntil: null,
    };
  }

  return {
    gatewayHealthStatus: 'cooling_down',
    gatewayUnhealthyUntil: unhealthyUntil,
  };
}

function resolveChannelCooldownMs(rawValue: string | undefined, fallback: number) {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isChannelCoolingDown(channelId: string, now = Date.now()) {
  return getGatewayChannelHealthSnapshot(channelId, now).gatewayHealthStatus === 'cooling_down';
}

export function markGatewayChannelHealthy(channelId: string) {
  channelUnhealthyUntil.delete(channelId);
}

export function markGatewayChannelUnhealthy(
  channelId: string,
  cooldownMs = DEFAULT_CHANNEL_UNHEALTHY_COOLDOWN_MS
) {
  channelUnhealthyUntil.set(channelId, Date.now() + cooldownMs);
}

export function markGatewayChannelUnhealthyForEnv(
  env: Pick<WorkerEnv, 'GATEWAY_CHANNEL_UNHEALTHY_COOLDOWN_MS'>,
  channelId: string,
  cooldownMs = DEFAULT_CHANNEL_UNHEALTHY_COOLDOWN_MS
) {
  markGatewayChannelUnhealthy(
    channelId,
    resolveChannelCooldownMs(env.GATEWAY_CHANNEL_UNHEALTHY_COOLDOWN_MS, cooldownMs)
  );
}

export async function listActiveGatewayChannels(
  env: WorkerEnv,
  channelIds: string[]
): Promise<GatewayChannel[]> {
  const uniqueChannelIds = [...new Set(channelIds)];
  const db = getDb(env);
  const rows = await db.select().from(channels).where(inArray(channels.id, uniqueChannelIds));

  const activeChannelsById = new Map(
    rows
      .filter((channel) => channel.status === 'active')
      .map((channel) => [
        channel.id,
        {
          id: channel.id,
          name: channel.name,
          provider: channel.provider,
          baseUrl: channel.baseUrl,
        } satisfies GatewayChannel,
      ])
  );

  return uniqueChannelIds
    .map((channelId) => activeChannelsById.get(channelId) ?? null)
    .filter((channel): channel is GatewayChannel => channel !== null);
}

export async function requireActiveGatewayChannels(
  env: WorkerEnv,
  channelIds: string[]
): Promise<GatewayChannel[]> {
  const activeChannels = await listActiveGatewayChannels(env, channelIds);

  if (activeChannels.length === 0) {
    throw new Response(JSON.stringify({ error: 'Allowed channels are not active' }), {
      status: 403,
    });
  }

  return activeChannels;
}

function hashStringToUint32(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function rotateChannels(channels: GatewayChannel[], offset: number) {
  if (channels.length <= 1 || offset === 0) {
    return channels;
  }

  return [...channels.slice(offset), ...channels.slice(0, offset)];
}

function prioritizeGatewayChannelBucket(
  channels: GatewayChannel[],
  traceId: string | null | undefined
) {
  if (channels.length <= 1 || !traceId) {
    return channels;
  }

  return rotateChannels(channels, hashStringToUint32(traceId) % channels.length);
}

export function prioritizeGatewayChannels(channels: GatewayChannel[], traceId?: string | null) {
  const now = Date.now();
  const healthyChannels: GatewayChannel[] = [];
  const coolingDownChannels: GatewayChannel[] = [];

  for (const channel of channels) {
    if (isChannelCoolingDown(channel.id, now)) {
      coolingDownChannels.push(channel);
      continue;
    }

    healthyChannels.push(channel);
  }

  return [
    ...prioritizeGatewayChannelBucket(healthyChannels, traceId),
    ...prioritizeGatewayChannelBucket(coolingDownChannels, traceId),
  ];
}
