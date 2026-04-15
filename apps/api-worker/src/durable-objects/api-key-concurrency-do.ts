import type { WorkerEnv } from '../index';

type LeaseRecord = {
  leaseId: string;
  apiKeyId: string;
  expiresAt: number;
};

type AcquireRequest = {
  action: 'acquire';
  apiKeyId: string;
  maxConcurrency: number;
  ttlMs?: number;
};

type ReleaseRequest = {
  action: 'release';
  leaseId: string;
};

type ConcurrencyRequest = AcquireRequest | ReleaseRequest;

type AcquireSuccess = {
  ok: true;
  leaseId: string;
  activeLeases: number;
  expiresAt: number;
};

type AcquireFailure = {
  ok: false;
  activeLeases: number;
};

type ReleaseResult = {
  ok: true;
};

const DEFAULT_TTL_MS = 30_000;

export class ApiKeyConcurrencyDurableObject {
  private readonly state: DurableObjectState;
  private readonly env: WorkerEnv;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    this.state = ctx;
    this.env = env;
  }

  private async loadLeases() {
    const leases = (await this.state.storage.get<Record<string, LeaseRecord>>('leases')) ?? {};
    const now = Date.now();
    let changed = false;

    for (const [leaseId, lease] of Object.entries(leases)) {
      if (lease.expiresAt <= now) {
        delete leases[leaseId];
        changed = true;
      }
    }

    if (changed) {
      await this.state.storage.put('leases', leases);
    }

    return leases;
  }

  async fetch(request: Request) {
    const payload = (await request.json()) as ConcurrencyRequest;

    if (payload.action === 'acquire') {
      const leases = await this.loadLeases();
      const activeLeases = Object.keys(leases).length;

      if (activeLeases >= payload.maxConcurrency) {
        return Response.json({
          ok: false,
          activeLeases,
        });
      }

      const leaseId = crypto.randomUUID();
      const expiresAt = Date.now() + (payload.ttlMs ?? DEFAULT_TTL_MS);
      leases[leaseId] = {
        leaseId,
        apiKeyId: payload.apiKeyId,
        expiresAt,
      };
      await this.state.storage.put('leases', leases);

      return Response.json({
        ok: true,
        leaseId,
        activeLeases: Object.keys(leases).length,
        expiresAt,
      });
    }

    const leases = await this.loadLeases();
    delete leases[payload.leaseId];
    await this.state.storage.put('leases', leases);

    return Response.json({ ok: true });
  }
}
