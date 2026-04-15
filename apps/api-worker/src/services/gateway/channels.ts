import { eq } from 'drizzle-orm';
import { channels, getDb } from '../../db/schema';
import type { WorkerEnv } from '../../index';

export type GatewayChannel = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
};

export async function requireActiveGatewayChannel(env: WorkerEnv, channelId: string): Promise<GatewayChannel> {
  const db = getDb(env);
  const channel = await db.select().from(channels).where(eq(channels.id, channelId)).get();

  if (!channel || channel.status !== 'active') {
    throw new Response(JSON.stringify({ error: 'Allowed channel is not active' }), { status: 403 });
  }

  return {
    id: channel.id,
    name: channel.name,
    provider: channel.provider,
    baseUrl: channel.baseUrl,
  };
}
