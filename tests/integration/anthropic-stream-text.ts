// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  requestJson,
  withMockSseUpstream,
} from './_anthropic';

const MODEL = 'claude-3-5-sonnet-latest';
const EXPECTED_TOTAL_COST_MICROS = 138;

function encodeChunk(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function parseSseEvents(payload: string) {
  const blocks = payload.split('\n\n').filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n');
    const event = lines
      .find((line) => line.startsWith('event:'))
      ?.slice('event:'.length)
      .trim();
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n');

    return {
      event,
      data: data ? JSON.parse(data) : null,
    };
  });
}

async function callAnthropicStream(rawKey: string) {
  const response = await fetch(`${WORKER_BASE_URL}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 128,
      stream: true,
      messages: [{ role: 'user', content: 'Say hello' }],
    }),
  });

  const text = await response.text();
  return {
    response,
    events: parseSseEvents(text),
    raw: text,
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
  await withMockSseUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      assert(parsed.model === MODEL, `Unexpected model: ${JSON.stringify(parsed)}`);
      const chunks = [
        encodeChunk({
          id: 'chatcmpl-anthropic-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000001,
          model: parsed.model,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Hel',
              },
              finish_reason: null,
            },
          ],
        }),
        encodeChunk({
          id: 'chatcmpl-anthropic-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000001,
          model: parsed.model,
          choices: [
            {
              index: 0,
              delta: {
                content: 'lo',
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
        'data: [DONE]\n\n',
      ];

      return chunks.join('');
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const channelName = `anthropic-stream-text-${Date.now()}`;
      const channelId = await createChannel(cookie, {
        name: channelName,
        provider: 'anthropic',
        protocol: 'anthropic_messages',
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `anthropic-stream-text-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['anthropic_messages'],
      });
      const { response, events, raw } = await callAnthropicStream(rawKey);

      assert(response.ok, `Stream request failed: ${raw}`);
      assert(
        response.headers.get('content-type')?.includes('text/event-stream'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );
      const traceId = response.headers.get('x-trace-id');
      assert(traceId, 'Missing x-trace-id header');

      const eventNames = events.map((event) => event.event);
      assert(
        eventNames[0] === 'message_start',
        `Expected first event to be message_start, got ${eventNames[0]}`
      );
      assert(eventNames.includes('content_block_start'), `Missing content_block_start: ${raw}`);
      assert(
        eventNames.filter((event) => event === 'content_block_delta').length >= 1,
        `Expected at least one content_block_delta: ${raw}`
      );
      assert(eventNames.includes('content_block_stop'), `Missing content_block_stop: ${raw}`);
      assert(eventNames.includes('message_delta'), `Missing message_delta: ${raw}`);
      assert(
        eventNames[eventNames.length - 1] === 'message_stop',
        `Expected last event to be message_stop, got ${eventNames[eventNames.length - 1]}`
      );

      const textDeltas = events
        .filter((event) => event.event === 'content_block_delta')
        .map((event) => event.data?.delta?.text ?? '')
        .join('');
      assert(textDeltas === 'Hello', `Unexpected text deltas: ${textDeltas}`);

      const messageStart = events.find((event) => event.event === 'message_start');
      const messageDelta = events.find((event) => event.event === 'message_delta');
      assert(
        messageStart?.data?.message?.content?.length === 0,
        `Unexpected message_start payload: ${JSON.stringify(messageStart)}`
      );
      assert(
        messageDelta?.data?.delta?.stop_reason === 'end_turn',
        `Unexpected stop_reason: ${JSON.stringify(messageDelta)}`
      );
      assert(
        messageStart?.data?.message?.usage?.input_tokens === null,
        `Unexpected message_start usage: ${JSON.stringify(messageStart)}`
      );
      assert(
        messageStart?.data?.message?.usage?.output_tokens === null,
        `Unexpected message_start usage: ${JSON.stringify(messageStart)}`
      );
      assert(
        messageDelta?.data?.usage?.input_tokens === 11,
        `Unexpected message_delta usage: ${JSON.stringify(messageDelta)}`
      );
      assert(
        messageDelta?.data?.usage?.output_tokens === 7,
        `Unexpected message_delta usage: ${JSON.stringify(messageDelta)}`
      );

      const portalCookie = await exchangePortal(rawKey);
      const overview = await requestJson('/portal/me', { method: 'GET' }, portalCookie);
      assert(overview.response.ok, `Portal me failed: ${JSON.stringify(overview.json)}`);
      assert(
        overview.json?.usage?.tokens?.inputTokens === 11,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.tokens?.outputTokens === 7,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.tokens?.totalTokens === 18,
        `Unexpected overview: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.totalCostMicros === EXPECTED_TOTAL_COST_MICROS,
        `Unexpected overview cost: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.usage?.cost?.totalCostMicros === EXPECTED_TOTAL_COST_MICROS,
        `Unexpected overview nested cost: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.apiKey?.channels?.[0]?.name === channelName,
        `Unexpected apiKey channels: ${JSON.stringify(overview.json)}`
      );
      assert(
        overview.json?.apiKey?.channels?.[0]?.provider === 'anthropic',
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
        history.json[0]?.totalCostMicros === EXPECTED_TOTAL_COST_MICROS,
        `Unexpected history cost: ${JSON.stringify(history.json)}`
      );
      assert(
        history.json[0]?.provider === 'anthropic',
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
      assert(auditItem?.inputTokens === 11, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(auditItem?.outputTokens === 7, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(auditItem?.totalTokens === 18, `Unexpected audit item: ${JSON.stringify(audit.json)}`);
      assert(
        auditItem?.totalCostMicros === EXPECTED_TOTAL_COST_MICROS,
        `Unexpected audit cost: ${JSON.stringify(audit.json)}`
      );
      assert(
        auditItem?.provider === 'anthropic',
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
        (analyticsData?.totalCostMicros ?? 0) >= EXPECTED_TOTAL_COST_MICROS,
        `Unexpected analytics cost: ${JSON.stringify(analytics.json)}`
      );
      const endpointItem = analyticsData?.endpointBreakdown?.find(
        (item) => item.endpoint === 'anthropic_messages'
      );
      assert(
        (endpointItem?.totalCostMicros ?? 0) >= EXPECTED_TOTAL_COST_MICROS,
        `Unexpected endpoint cost: ${JSON.stringify(analytics.json)}`
      );
      const channelItem = analyticsData?.channelBreakdown?.find(
        (item) => item.channelId === channelId
      );
      assert(
        channelItem?.totalCostMicros === EXPECTED_TOTAL_COST_MICROS,
        `Unexpected channel cost: ${JSON.stringify(analytics.json)}`
      );
      assert(
        channelItem?.provider === 'anthropic',
        `Unexpected channel provider: ${JSON.stringify(analytics.json)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            traceId,
            events: eventNames,
            text: textDeltas,
            stopReason: messageDelta.data.delta.stop_reason,
            usage: messageDelta.data.usage,
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
