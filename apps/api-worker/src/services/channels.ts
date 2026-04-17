import { eq } from 'drizzle-orm';
import type {
  CreateChannelInput,
  UpdateChannelInput,
  UpdateChannelStatusInput,
} from '@uhub/shared';
import { channels, getDb } from '../db/schema';
import type { WorkerEnv } from '../index';

export async function listChannels(env: WorkerEnv) {
  const db = getDb(env);
  return db.select().from(channels).orderBy(channels.createdAt);
}

export async function createChannel(env: WorkerEnv, input: CreateChannelInput) {
  const db = getDb(env);
  const now = Date.now();
  const id = crypto.randomUUID();

  await db.insert(channels).values({
    id,
    name: input.name,
    provider: input.provider,
    baseUrl: input.baseUrl,
    status: input.status,
    configJson: input.configJson,
    createdAt: now,
    updatedAt: now,
  });

  return db.select().from(channels).where(eq(channels.id, id)).get();
}

export async function updateChannel(env: WorkerEnv, input: UpdateChannelInput) {
  const db = getDb(env);

  await db
    .update(channels)
    .set({
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
      status: input.status,
      configJson: input.configJson,
      updatedAt: Date.now(),
    })
    .where(eq(channels.id, input.id));

  return db.select().from(channels).where(eq(channels.id, input.id)).get();
}

export async function updateChannelStatus(env: WorkerEnv, input: UpdateChannelStatusInput) {
  const db = getDb(env);

  await db
    .update(channels)
    .set({
      status: input.status,
      updatedAt: Date.now(),
    })
    .where(eq(channels.id, input.id));

  return db.select().from(channels).where(eq(channels.id, input.id)).get();
}
