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

const STOP_SEQUENCE = '<STOP>';
const MODEL = 'gemini-2.5-flash';

async function callGemini(rawKey: string) {
  const response = await fetch(
    `${WORKER_BASE_URL}/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${rawKey}`,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Say hello' }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 64,
          stopSequences: [STOP_SEQUENCE],
        },
      }),
    }
  );

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
  const expectedTotalCostMicros = 23;

  await withMockJsonUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      assert(parsed.model === MODEL, `Unexpected model: ${JSON.stringify(parsed)}`);
      assert(
        parsed.messages?.[0]?.role === 'user',
        `Unexpected messages: ${JSON.stringify(parsed)}`
      );
      assert(
        parsed.messages?.[0]?.content === 'Say hello',
        `Unexpected messages: ${JSON.stringify(parsed)}`
      );
      assert(parsed.max_tokens === 64, `Unexpected max_tokens: ${JSON.stringify(parsed)}`);
      assert(
        Array.isArray(parsed.stop) && parsed.stop[0] === STOP_SEQUENCE,
        `Unexpected stop sequence: ${JSON.stringify(parsed)}`
      );

      return {
        body: JSON.stringify({
          id: 'chatcmpl-gemini-nonstream-test',
          object: 'chat.completion',
          created: 1710000010,
          model: parsed.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: `Hello${STOP_SEQUENCE}ignored`,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 8,
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
      const channelName = `gemini-nonstream-${Date.now()}`;
      const channelId = await createChannel(cookie, {
        name: channelName,
        provider: 'gemini',
        protocol: 'gemini_contents',
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `gemini-nonstream-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['gemini_contents'],
      });

      const { response, json } = await callGemini(rawKey);

      assert(response.ok, `Gemini request failed: ${JSON.stringify(json)}`);
      assert(
        response.headers.get('content-type')?.includes('application/json'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );
      assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');
      assert(Array.isArray(json?.candidates), `Unexpected candidates: ${JSON.stringify(json)}`);
      assert(
        json.candidates[0]?.content?.role === 'model',
        `Unexpected role: ${JSON.stringify(json)}`
      );
      assert(
        json.candidates[0]?.content?.parts?.[0]?.text === 'Hello',
        `Unexpected translated text: ${JSON.stringify(json)}`
      );
      assert(
        json.candidates[0]?.finishReason === 'STOP',
        `Unexpected finishReason: ${json.candidates[0]?.finishReason}`
      );
      assert(
        json?.usageMetadata?.promptTokenCount === 10,
        `Unexpected promptTokenCount: ${JSON.stringify(json)}`
      );
      assert(
        json?.usageMetadata?.candidatesTokenCount === 8,
        `Unexpected candidatesTokenCount: ${JSON.stringify(json)}`
      );
      assert(
        json?.usageMetadata?.totalTokenCount === 18,
        `Unexpected totalTokenCount: ${JSON.stringify(json)}`
      );

      const traceId = response.headers.get('x-trace-id');
      const portalCookie = await exchangePortal(rawKey);
      const overview = await requestJson('/portal/me', { method: 'GET' }, portalCookie);
      assert(overview.response.ok, `Portal me failed: ${JSON.stringify(overview.json)}`);
      assert(
        overview.json?.usage?.tokens?.inputTokens === 10,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.tokens?.outputTokens === 8,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.tokens?.totalTokens === 18,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.totalCostMicros === expectedTotalCostMicros,
        `Unexpected overview cost: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.cost?.totalCostMicros === expectedTotalCostMicros,
        `Unexpected overview nested cost: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.apiKey?.channels?.[0]?.name === channelName,
        `Unexpected apiKey channels: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.apiKey?.channels?.[0]?.provider === 'gemini',
        `Unexpected apiKey channels: ${JSON.stringify(overview.json)}`
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
        history.json[0]?.inputTokens === 10,
        `Unexpected history item: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.outputTokens === 8,
        `Unexpected history item: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.totalTokens === 18,
        `Unexpected history item: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.totalCostMicros === expectedTotalCostMicros,
        `Unexpected history cost: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.provider === 'gemini',
        `Unexpected history item: ${JSON.stringify(history.json)}`
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
      assert(auditItem?.inputTokens === 10, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(auditItem?.outputTokens === 8, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(auditItem?.totalTokens === 18, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(
        auditItem?.totalCostMicros === expectedTotalCostMicros,
        `Unexpected audit cost: ${JSON.stringify(audit.json)}`
      );
      assert(
        auditItem?.provider === 'gemini',
        `Unexpected audit item: ${JSON.stringify(audit.json)}`
      );

      const analytics = await requestJson(
        '/trpc/admin.analytics.summary',
        { method: 'GET' },
        cookie
      );
      assert(analytics.response.ok, `Analytics failed: ${JSON.stringify(analytics.json)}`);
      const analyticsData = analytics.json?.result?.data;
      assert(
        analyticsData?.totalCostMicros === expectedTotalCostMicros,
        `Unexpected analytics cost: ${JSON.stringify(analytics.json)}`
      );
      const endpointItem = analyticsData?.endpointBreakdown?.find(
        (item) => item.endpoint === 'gemini_contents'
      );
      assert(
        endpointItem?.totalCostMicros === expectedTotalCostMicros,
        `Unexpected endpoint cost: ${JSON.stringify(analytics.json)}`
      );
      const channelItem = analyticsData?.channelBreakdown?.find((item) => item.channelId === channelId);
      assert(
        channelItem?.totalCostMicros === expectedTotalCostMicros,
        `Unexpected channel cost: ${JSON.stringify(analytics.json)}`
      );
      assert(
        channelItem?.provider === 'gemini',
        `Unexpected channel provider: ${JSON.stringify(analytics.json)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            workerBaseUrl: WORKER_BASE_URL,
            upstreamBaseUrl: baseUrl,
            traceId,
            text: json.candidates[0].content.parts[0].text,
            finishReason: json.candidates[0].finishReason,
            usageMetadata: json.usageMetadata,
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
