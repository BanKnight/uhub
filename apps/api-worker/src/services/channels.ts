import { eq } from 'drizzle-orm';
import type {
  Channel,
  CreateChannelInput,
  UpdateChannelInput,
  UpdateChannelStatusInput,
} from '@uhub/shared';
import { channels, getDb } from '../db/schema';
import type { WorkerEnv } from '../index';
import { getGatewayChannelHealthSnapshot } from './gateway/channels';

function parseModels(modelsJson: string): string[] {
  try {
    const parsed = JSON.parse(modelsJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function toChannel(row: typeof channels.$inferSelect): Channel {
  const gatewayHealth = getGatewayChannelHealthSnapshot(row.id);

  return {
    id: row.id,
    name: row.name,
    provider: row.provider as Channel['provider'],
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    models: parseModels(row.modelsJson),
    defaultTestModel: row.defaultTestModel,
    status: row.status,
    gatewayHealthStatus: gatewayHealth.gatewayHealthStatus,
    gatewayUnhealthyUntil: gatewayHealth.gatewayUnhealthyUntil,
    configJson: row.configJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listChannels(env: WorkerEnv): Promise<Channel[]> {
  const db = getDb(env);
  const rows = await db.select().from(channels).orderBy(channels.createdAt);
  return rows.map(toChannel);
}

export async function createChannel(
  env: WorkerEnv,
  input: CreateChannelInput
): Promise<Channel | undefined> {
  const db = getDb(env);
  const now = Date.now();
  const id = crypto.randomUUID();

  await db.insert(channels).values({
    id,
    name: input.name,
    provider: input.provider,
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    modelsJson: JSON.stringify(input.models),
    defaultTestModel: input.defaultTestModel,
    status: input.status,
    configJson: '{}',
    createdAt: now,
    updatedAt: now,
  });

  const row = await db.select().from(channels).where(eq(channels.id, id)).get();
  return row ? toChannel(row) : undefined;
}

export async function updateChannel(
  env: WorkerEnv,
  input: UpdateChannelInput
): Promise<Channel | undefined> {
  const db = getDb(env);
  const existingRow = await db.select().from(channels).where(eq(channels.id, input.id)).get();

  if (!existingRow) {
    return undefined;
  }

  const normalizedDefaultTestModel =
    input.defaultTestModel !== null && input.models.includes(input.defaultTestModel)
      ? input.defaultTestModel
      : null;

  await db
    .update(channels)
    .set({
      name: input.name,
      provider: input.provider,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      modelsJson: JSON.stringify(input.models),
      defaultTestModel: normalizedDefaultTestModel,
      status: input.status,
      configJson: existingRow.configJson,
      updatedAt: Date.now(),
    })
    .where(eq(channels.id, input.id));

  const row = await db.select().from(channels).where(eq(channels.id, input.id)).get();
  return row ? toChannel(row) : undefined;
}

export async function updateChannelStatus(
  env: WorkerEnv,
  input: UpdateChannelStatusInput
): Promise<Channel | undefined> {
  const db = getDb(env);

  await db
    .update(channels)
    .set({
      status: input.status,
      updatedAt: Date.now(),
    })
    .where(eq(channels.id, input.id));

  const row = await db.select().from(channels).where(eq(channels.id, input.id)).get();
  return row ? toChannel(row) : undefined;
}
