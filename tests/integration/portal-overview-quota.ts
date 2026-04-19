// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  requestJson,
  withMockJsonUpstream,
} from './_anthropic';

async function callOpenAi(rawKey: string) {
  const response = await fetch(`${WORKER_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Spend one request' }],
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
        id: 'chatcmpl-portal-quota-test',
        object: 'chat.completion',
        created: 1710000012,
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Done',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 4,
          total_tokens: 13,
        },
      }),
      headers: {
        'content-type': 'application/json',
      },
    }),
    async (baseUrl) => {
      const adminCookie = await ensureAdminSession();
      const channelId = await createChannel(adminCookie, {
        name: `portal-quota-${Date.now()}`,
        baseUrl,
        protocol: 'openai_chat_completions',
        models: ['gpt-4o-mini'],
      });
      const rawKey = await createApiKey(adminCookie, {
        label: `portal-quota-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['openai_chat_completions'],
        quota: {
          requestLimit: 1,
        },
      });

      const requestResult = await callOpenAi(rawKey);
      assert(
        requestResult.response.ok,
        `OpenAI request failed: ${JSON.stringify(requestResult.json)}`
      );

      const portalAuth = await exchangePortal(rawKey);
      assert(portalAuth.response.ok, `Portal exchange failed: ${JSON.stringify(portalAuth.json)}`);
      assert(portalAuth.cookie, 'Portal exchange did not establish a session cookie');

      const overview = await requestJson('/portal/me', { method: 'GET' }, portalAuth.cookie);
      assert(overview.response.ok, `Portal me failed: ${JSON.stringify(overview.json)}`);
      assert(
        overview.json?.apiKey?.quota?.requestLimit === 1,
        `Unexpected apiKey quota: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.quotaLimit === 1,
        `Unexpected quotaLimit: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.quotaUsed === 1,
        `Unexpected quotaUsed: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.quotaRemaining === 0,
        `Unexpected quotaRemaining: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.inputTokens === 9,
        `Unexpected inputTokens: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.outputTokens === 4,
        `Unexpected outputTokens: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.totalTokens === 13,
        `Unexpected totalTokens: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.tokenUsageAvailability === 'available',
        `Unexpected tokenUsageAvailability: ${JSON.stringify(overview.json)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            workerBaseUrl: WORKER_BASE_URL,
            upstreamBaseUrl: baseUrl,
            quota: overview.json.usage,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
