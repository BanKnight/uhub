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
      messages: [{ role: 'user', content: 'Say hello from OpenAI path' }],
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawKey }),
  });
  const cookie = response.headers.getSetCookie?.()[0]?.split(';', 1)[0] ?? '';
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  assert(response.ok, `Portal exchange failed: ${JSON.stringify(json)}`);
  assert(cookie, 'Portal exchange did not establish a session cookie');

  return cookie;
}

async function main() {
  await withMockJsonUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      assert(parsed.model === 'gpt-4o-mini', `Unexpected model: ${JSON.stringify(parsed)}`);
      assert(
        parsed.messages?.[0]?.role === 'user',
        `Unexpected messages: ${JSON.stringify(parsed)}`
      );
      assert(
        parsed.messages?.[0]?.content === 'Say hello from OpenAI path',
        `Unexpected messages: ${JSON.stringify(parsed)}`
      );

      return {
        body: JSON.stringify({
          id: 'chatcmpl-openai-nonstream-test',
          object: 'chat.completion',
          created: 1710000011,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello from OpenAI path',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            total_tokens: 18,
          },
        }),
        headers: {
          'content-type': 'application/json',
        },
      };
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const channelId = await createChannel(cookie, {
        name: `openai-nonstream-${Date.now()}`,
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `openai-nonstream-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['openai_chat_completions'],
      });

      const { response, json } = await callOpenAi(rawKey);

      assert(response.ok, `OpenAI request failed: ${JSON.stringify(json)}`);
      assert(
        response.headers.get('content-type')?.includes('application/json'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );
      assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');
      assert(
        json?.object === 'chat.completion',
        `Unexpected response object: ${JSON.stringify(json)}`
      );
      assert(json?.model === 'gpt-4o-mini', `Unexpected response model: ${json?.model}`);
      assert(
        json?.choices?.[0]?.message?.content === 'Hello from OpenAI path',
        `Unexpected translated text: ${JSON.stringify(json)}`
      );
      assert(json?.usage?.prompt_tokens === 11, `Unexpected usage: ${JSON.stringify(json)}`);
      assert(json?.usage?.completion_tokens === 7, `Unexpected usage: ${JSON.stringify(json)}`);
      assert(json?.usage?.total_tokens === 18, `Unexpected usage: ${JSON.stringify(json)}`);

      const traceId = response.headers.get('x-trace-id');
      const portalCookie = await exchangePortal(rawKey);
      const overview = await requestJson('/portal/me', { method: 'GET' }, portalCookie);
      assert(overview.response.ok, `Portal me failed: ${JSON.stringify(overview.json)}`);
      assert(
        overview.json?.usage?.inputTokens === 11,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.outputTokens === 7,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.totalTokens === 18,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.tokenUsageAvailability === 'available',
        `Unexpected overview availability: ${JSON.stringify(overview.json)}`
      );

      const history = await requestJson('/portal/requests', { method: 'GET' }, portalCookie);
      assert(history.response.ok, `Portal requests failed: ${JSON.stringify(history.json)}`);
      assert(
        Array.isArray(history.json) && history.json.length > 0,
        'Portal requests should not be empty'
      );
      assert(
        history.json[0]?.traceId === traceId,
        `Unexpected history item: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.inputTokens === 11,
        `Unexpected history item: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.outputTokens === 7,
        `Unexpected history item: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.totalTokens === 18,
        `Unexpected history item: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.tokenUsageAvailability === 'available',
        `Unexpected history availability: ${JSON.stringify(history.json)}`
      );

      const audit = await requestJson(
        `/trpc/admin.audit.list?input=${encodeURIComponent(JSON.stringify({ traceId }))}`,
        { method: 'GET' },
        cookie
      );
      assert(audit.response.ok, `Audit failed: ${JSON.stringify(audit.json)}`);
      const auditItem = audit.json?.result?.data?.[0];
      assert(
        auditItem?.traceId === traceId,
        `Unexpected audit item: ${JSON.stringify(audit.json)}`
      );
      assert(auditItem?.inputTokens === 11, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(auditItem?.outputTokens === 7, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(auditItem?.totalTokens === 18, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(
        auditItem?.tokenUsageAvailability === 'available',
        `Unexpected audit availability: ${JSON.stringify(audit.json)}`
      );

      const analytics = await requestJson(
        '/trpc/admin.analytics.summary',
        { method: 'GET' },
        cookie
      );
      assert(analytics.response.ok, `Analytics failed: ${JSON.stringify(analytics.json)}`);
      const analyticsData = analytics.json?.result?.data;
      assert(
        analyticsData?.inputTokens === 11,
        `Unexpected analytics: ${JSON.stringify(analytics.json)}`
      );
      assert(
        analyticsData?.outputTokens === 7,
        `Unexpected analytics: ${JSON.stringify(analytics.json)}`
      );
      assert(
        analyticsData?.totalTokens === 18,
        `Unexpected analytics: ${JSON.stringify(analytics.json)}`
      );
      assert(
        analyticsData?.tokenUsageAvailability === 'available',
        `Unexpected analytics availability: ${JSON.stringify(analytics.json)}`
      );
      const endpointItem = analyticsData?.endpointBreakdown?.find(
        (item) => item.endpoint === 'openai_chat_completions'
      );
      assert(
        endpointItem?.inputTokens === 11,
        `Unexpected endpoint breakdown: ${JSON.stringify(analytics.json)}`
      );
      assert(
        endpointItem?.outputTokens === 7,
        `Unexpected endpoint breakdown: ${JSON.stringify(analytics.json)}`
      );
      assert(
        endpointItem?.totalTokens === 18,
        `Unexpected endpoint breakdown: ${JSON.stringify(analytics.json)}`
      );
      assert(
        endpointItem?.tokenUsageAvailability === 'available',
        `Unexpected endpoint availability: ${JSON.stringify(analytics.json)}`
      );
      const channelItem = analyticsData?.channelBreakdown?.find(
        (item) => item.channelId === channelId
      );
      assert(
        channelItem?.inputTokens === 11,
        `Unexpected channel breakdown: ${JSON.stringify(analytics.json)}`
      );
      assert(
        channelItem?.outputTokens === 7,
        `Unexpected channel breakdown: ${JSON.stringify(analytics.json)}`
      );
      assert(
        channelItem?.totalTokens === 18,
        `Unexpected channel breakdown: ${JSON.stringify(analytics.json)}`
      );
      assert(
        channelItem?.tokenUsageAvailability === 'available',
        `Unexpected channel availability: ${JSON.stringify(analytics.json)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            workerBaseUrl: WORKER_BASE_URL,
            upstreamBaseUrl: baseUrl,
            traceId,
            text: json.choices[0].message.content,
            usage: json.usage,
            overviewUsage: overview.json.usage,
            historyUsage: history.json[0],
            auditUsage: auditItem,
            analyticsUsage: {
              summary: analyticsData,
              endpoint: endpointItem,
              channel: channelItem,
            },
          },
          null,
          2
        )
      );
    }
  );
}

await main();
