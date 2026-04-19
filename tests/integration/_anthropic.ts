// @ts-nocheck
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export const WORKER_BASE_URL = process.env.UHUB_WORKER_BASE_URL ?? 'http://127.0.0.1:8797';
export const ADMIN_EMAIL = process.env.UHUB_ADMIN_EMAIL ?? 'admin@example.com';
export const ADMIN_PASSWORD = process.env.UHUB_ADMIN_PASSWORD ?? 'admin123456';

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseSetCookie(headers: Headers) {
  return headers.getSetCookie?.() ?? [];
}

function mergeCookies(existing: string, setCookies: string[]) {
  const jar = new Map<string, string>();

  for (const chunk of existing.split(/;\s*/).filter(Boolean)) {
    const [name, ...rest] = chunk.split('=');
    if (name && rest.length > 0) {
      jar.set(name, rest.join('='));
    }
  }

  for (const cookie of setCookies) {
    const firstPart = cookie.split(';', 1)[0];
    const [name, ...rest] = firstPart.split('=');
    if (name && rest.length > 0) {
      jar.set(name, rest.join('='));
    }
  }

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export async function requestJson(path: string, init: RequestInit = {}, cookie = '') {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (cookie) {
    headers.set('cookie', cookie);
  }

  const response = await fetch(`${WORKER_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  return {
    response,
    json,
    cookie: mergeCookies(cookie, parseSetCookie(response.headers)),
  };
}

export async function ensureAdminSession() {
  const signIn = await requestJson('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }),
  });

  assert(signIn.response.ok, `Admin sign-in failed: ${JSON.stringify(signIn.json)}`);
  assert(signIn.cookie, 'Admin sign-in did not establish a session cookie');
  return signIn.cookie;
}

function resolveProvider(
  protocol: 'openai_chat_completions' | 'anthropic_messages' | 'gemini_contents'
) {
  if (protocol === 'anthropic_messages') {
    return 'anthropic';
  }

  if (protocol === 'gemini_contents') {
    return 'gemini';
  }

  return 'openai';
}

export async function createChannel(
  cookie: string,
  input: {
    name: string;
    baseUrl: string;
    provider?: 'openai' | 'anthropic' | 'gemini';
    protocol?: 'openai_chat_completions' | 'anthropic_messages' | 'gemini_contents';
    models?: string[];
    status?: 'active' | 'disabled';
  }
) {
  const protocol = input.protocol ?? 'openai_chat_completions';
  const result = await requestJson(
    '/trpc/admin.channels.create',
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        provider: input.provider ?? resolveProvider(protocol),
        protocol,
        baseUrl: input.baseUrl,
        models: input.models ?? [],
        status: input.status ?? 'active',
      }),
    },
    cookie
  );

  assert(result.response.ok, `Create channel failed: ${JSON.stringify(result.json)}`);
  assert(result.json?.result?.data?.id, 'Channel response missing id');
  return result.json.result.data.id as string;
}

export async function createApiKey(
  cookie: string,
  input: {
    label: string;
    channelIds: string[];
    endpointRules: string[];
    maxConcurrency?: number;
    expiresAt?: number | null;
    quota?: { requestLimit: number | null };
  }
) {
  const result = await requestJson(
    '/trpc/admin.apiKeys.create',
    {
      method: 'POST',
      body: JSON.stringify({
        label: input.label,
        channelIds: input.channelIds,
        endpointRules: input.endpointRules,
        maxConcurrency: input.maxConcurrency ?? 1,
        expiresAt: input.expiresAt ?? null,
        quota: input.quota,
      }),
    },
    cookie
  );

  assert(result.response.ok, `Create API key failed: ${JSON.stringify(result.json)}`);
  assert(result.json?.result?.data?.rawKey, 'API key response missing rawKey');
  return result.json.result.data.rawKey as string;
}

export async function listChannels(cookie: string) {
  const result = await requestJson('/trpc/admin.channels.list', { method: 'GET' }, cookie);

  assert(result.response.ok, `List channels failed: ${JSON.stringify(result.json)}`);
  return (result.json?.result?.data ?? []) as Array<{
    id: string;
    name: string;
    provider: string;
    protocol: string;
    baseUrl: string;
    models: string[];
    status: string;
    configJson: string;
  }>;
}

export async function updateChannel(
  cookie: string,
  input: {
    id: string;
    name: string;
    provider: 'openai' | 'anthropic' | 'gemini';
    protocol: 'openai_chat_completions' | 'anthropic_messages' | 'gemini_contents';
    baseUrl: string;
    models?: string[];
    status?: 'active' | 'disabled';
  }
) {
  const result = await requestJson(
    '/trpc/admin.channels.update',
    {
      method: 'POST',
      body: JSON.stringify({
        id: input.id,
        name: input.name,
        provider: input.provider,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        models: input.models ?? [],
        status: input.status ?? 'active',
      }),
    },
    cookie
  );

  assert(result.response.ok, `Update channel failed: ${JSON.stringify(result.json)}`);
  assert(result.json?.result?.data?.id, 'Update channel response missing id');
  return result.json.result.data as {
    id: string;
    name: string;
    provider: string;
    protocol: string;
    baseUrl: string;
    models: string[];
    status: string;
    configJson: string;
  };
}

export async function updateChannelStatus(
  cookie: string,
  input: {
    id: string;
    status: 'active' | 'disabled';
  }
) {
  const result = await requestJson(
    '/trpc/admin.channels.status',
    {
      method: 'POST',
      body: JSON.stringify({
        id: input.id,
        status: input.status,
      }),
    },
    cookie
  );

  assert(result.response.ok, `Update channel status failed: ${JSON.stringify(result.json)}`);
  assert(result.json?.result?.data?.id, 'Update channel status response missing id');
  return result.json.result.data as {
    id: string;
    name: string;
    provider: string;
    protocol: string;
    baseUrl: string;
    models: string[];
    status: string;
    configJson: string;
  };
}

async function withMockUpstream(
  handler: (
    body: string,
    response: {
      writeHead: (statusCode: number, headers?: Record<string, string>) => void;
      end: (body?: string) => void;
    }
  ) => void,
  run: (baseUrl: string) => Promise<void>
) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    handler(body, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

export async function withMockJsonUpstream(
  handler: (body: string) => {
    status?: number;
    headers?: Record<string, string>;
    body: string;
  },
  run: (baseUrl: string) => Promise<void>
) {
  await withMockUpstream((body, response) => {
    const result = handler(body);
    const status = result.status ?? 200;
    const headers = result.headers ?? { 'content-type': 'application/json' };
    response.writeHead(status, headers);
    response.end(result.body);
  }, run);
}

export async function withMockSseUpstream(
  handler: (body: string) => string,
  run: (baseUrl: string) => Promise<void>
) {
  await withMockUpstream((body, response) => {
    const payload = handler(body);
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.end(payload);
  }, run);
}
