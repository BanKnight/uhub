import type { GatewayEndpoint } from '@uhub/shared';
import { findApiKeyByRawKey } from '../services/api-keys';
import type { WorkerEnv } from '../index';

type GatewayApiKey = NonNullable<Awaited<ReturnType<typeof findApiKeyByRawKey>>>;

export type GatewayAuthResult = {
  apiKey: GatewayApiKey;
  channelId: string;
};

function readBearerToken(request: Request) {
  const authorization = request.headers.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length).trim() || null;
}

export async function requireApiKey(env: WorkerEnv, request: Request, endpoint: GatewayEndpoint): Promise<GatewayAuthResult> {
  const rawKey = readBearerToken(request);

  if (!rawKey) {
    throw new Response(JSON.stringify({ error: 'Missing bearer API key' }), { status: 401 });
  }

  const apiKey = await findApiKeyByRawKey(env, rawKey);

  if (!apiKey || apiKey.computedStatus !== 'active') {
    throw new Response(JSON.stringify({ error: 'API key is not active' }), { status: 401 });
  }

  if (!apiKey.endpointRules.includes(endpoint)) {
    throw new Response(JSON.stringify({ error: 'Endpoint is not allowed for this API key' }), { status: 403 });
  }

  const [channelId] = apiKey.channelIds;

  if (!channelId) {
    throw new Response(JSON.stringify({ error: 'API key has no allowed channels' }), { status: 403 });
  }

  return { apiKey, channelId };
}
