import type { WorkerEnv } from '../index';

const CONCURRENCY_DO_NAME = 'API_KEY_CONCURRENCY';
const DEFAULT_LEASE_TTL_MS = 30_000;

type AcquireLeaseResult =
  | {
      ok: true;
      leaseId: string;
      activeLeases: number;
      expiresAt: number;
    }
  | {
      ok: false;
      activeLeases: number;
    };

export type GatewayLease = {
  leaseId: string;
  expiresAt: number;
};

function getConcurrencyStub(env: WorkerEnv, apiKeyId: string) {
  const id = env.API_KEY_CONCURRENCY.idFromName(`${CONCURRENCY_DO_NAME}:${apiKeyId}`);
  return env.API_KEY_CONCURRENCY.get(id);
}

export async function acquireConcurrencyLease(env: WorkerEnv, apiKeyId: string, maxConcurrency: number) {
  const response = await getConcurrencyStub(env, apiKeyId).fetch('https://do.internal/acquire', {
    method: 'POST',
    body: JSON.stringify({
      action: 'acquire',
      apiKeyId,
      maxConcurrency,
      ttlMs: DEFAULT_LEASE_TTL_MS,
    }),
  });
  const payload = (await response.json()) as AcquireLeaseResult;

  if (!payload.ok) {
    return null;
  }

  return {
    leaseId: payload.leaseId,
    expiresAt: payload.expiresAt,
  } satisfies GatewayLease;
}

export async function releaseConcurrencyLease(env: WorkerEnv, apiKeyId: string, leaseId: string) {
  await getConcurrencyStub(env, apiKeyId).fetch('https://do.internal/release', {
    method: 'POST',
    body: JSON.stringify({
      action: 'release',
      leaseId,
    }),
  });
}
