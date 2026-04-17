// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  withMockSseUpstream,
} from './_anthropic';

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
      model: 'claude-3-5-sonnet-latest',
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

async function main() {
  await withMockSseUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      const chunks = [
        encodeChunk({
          id: 'chatcmpl-anthropic-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000001,
          model: parsed.model ?? 'gpt-4o-mini',
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
          model: parsed.model ?? 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: {
                content: 'lo',
              },
              finish_reason: 'stop',
            },
          ],
        }),
        'data: [DONE]\n\n',
      ];

      return chunks.join('');
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const channelId = await createChannel(cookie, {
        name: `anthropic-stream-text-${Date.now()}`,
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
      assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');

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
        typeof messageDelta?.data?.usage?.output_tokens === 'number' &&
          messageDelta.data.usage.output_tokens > 0,
        `Unexpected usage payload: ${JSON.stringify(messageDelta)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            traceId: response.headers.get('x-trace-id'),
            events: eventNames,
            text: textDeltas,
            stopReason: messageDelta.data.delta.stop_reason,
            usage: messageDelta.data.usage,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
