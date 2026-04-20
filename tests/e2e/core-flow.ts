// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  requestJson,
  withMockJsonUpstream,
} from '../integration/_anthropic';

async function callOpenAi(rawKey: string) {
  const response = await fetch(`${WORKER_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Run core e2e flow' }],
    }),
  });

  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function exchangePortal(rawKey: string) {
  const response = await fetch(`${WORKER_BASE_URL}/portal/auth/exchange`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ rawKey }),
  });

  const text = await response.text();
  const cookie = response.headers.getSetCookie?.()[0]?.split(';', 1)[0] ?? '';

  return {
    response,
    json: text ? JSON.parse(text) : null,
    cookie,
  };
}

async function main() {
  await withMockJsonUpstream(
    () => ({
      body: JSON.stringify({
        id: 'chatcmpl-e2e-core-test',
        object: 'chat.completion',
        created: 1710000013,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Core flow complete',
            },
            finish_reason: 'stop',
          },
        ],
      }),
      headers: {
        'content-type': 'application/json',
      },
    }),
    async (baseUrl) => {
      const adminCookie = await ensureAdminSession();
      const channelName = `e2e-core-${Date.now()}`;
      const channelId = await createChannel(adminCookie, {
        name: channelName,
        baseUrl,
        protocol: 'openai_chat_completions',
        models: ['gpt-4o-mini'],
      });
      const rawKey = await createApiKey(adminCookie, {
        label: `e2e-core-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['openai_chat_completions'],
        quota: {
          requestLimit: 2,
        },
      });

      const gatewayResult = await callOpenAi(rawKey);
      assert(
        gatewayResult.response.ok,
        `Gateway request failed: ${JSON.stringify(gatewayResult.json)}`
      );
      assert(
        gatewayResult.json?.choices?.[0]?.message?.content === 'Core flow complete',
        `Unexpected gateway response: ${JSON.stringify(gatewayResult.json)}`
      );

      const portalAuth = await exchangePortal(rawKey);
      assert(portalAuth.response.ok, `Portal exchange failed: ${JSON.stringify(portalAuth.json)}`);
      assert(portalAuth.cookie, 'Portal exchange did not establish a session cookie');

      const overview = await requestJson('/portal/me', { method: 'GET' }, portalAuth.cookie);
      const requests = await requestJson('/portal/requests', { method: 'GET' }, portalAuth.cookie);

      assert(overview.response.ok, `Portal overview failed: ${JSON.stringify(overview.json)}`);
      assert(requests.response.ok, `Portal requests failed: ${JSON.stringify(requests.json)}`);
      assert(
        overview.json?.usage?.quota?.quotaLimit === 2,
        `Unexpected quotaLimit: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.quota?.quotaUsed === 1,
        `Unexpected quotaUsed: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.quota?.quotaRemaining === 1,
        `Unexpected quotaRemaining: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.apiKey?.channels?.[0]?.name === channelName,
        `Unexpected apiKey channels: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.apiKey?.channels?.[0]?.provider === 'openai',
        `Unexpected apiKey channels: ${JSON.stringify(overview.json)}`
      );
      assert(
        Array.isArray(requests.json),
        `Portal requests should be an array: ${JSON.stringify(requests.json)}`
      );
      assert(requests.json.length >= 1, 'Portal requests should include the gateway request');
      assert(
        requests.json[0]?.endpoint === 'openai_chat_completions',
        `Unexpected request endpoint: ${JSON.stringify(requests.json[0])}`
      );
      assert(
        requests.json[0]?.status === 'completed',
        `Unexpected request status: ${JSON.stringify(requests.json[0])}`
      );
      assert(
        requests.json[0]?.channelName === channelName,
        `Unexpected request channel: ${JSON.stringify(requests.json[0])}`
      );
      assert(
        requests.json[0]?.provider === 'openai',
        `Unexpected request provider: ${JSON.stringify(requests.json[0])}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            workerBaseUrl: WORKER_BASE_URL,
            upstreamBaseUrl: baseUrl,
            quota: overview.json.usage,
            latestRequest: requests.json[0],
          },
          null,
          2
        )
      );
    }
  );
}

await main();
