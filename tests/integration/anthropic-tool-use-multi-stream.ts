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
      messages: [{ role: 'user', content: 'Use both tools' }],
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
          id: 'chatcmpl-anthropic-multi-tool-use-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000007,
          model: parsed.model ?? 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Let me check both tools.',
              },
              finish_reason: null,
            },
          ],
        }),
        encodeChunk({
          id: 'chatcmpl-anthropic-multi-tool-use-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000007,
          model: parsed.model ?? 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'toolu_weather_123',
                    type: 'function',
                    function: {
                      name: 'get_weather',
                      arguments: JSON.stringify({
                        city: 'Shanghai',
                      }),
                    },
                  },
                  {
                    index: 1,
                    id: 'toolu_time_456',
                    type: 'function',
                    function: {
                      name: 'get_time',
                      arguments: JSON.stringify({
                        city: 'Shanghai',
                      }),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        encodeChunk({
          id: 'chatcmpl-anthropic-multi-tool-use-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000007,
          model: parsed.model ?? 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: {},
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
        name: `anthropic-tool-use-multi-stream-${Date.now()}`,
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `anthropic-tool-use-multi-stream-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['anthropic_messages'],
      });
      const { response, events, raw } = await callAnthropicStream(rawKey);

      assert(response.ok, `Stream multi tool_use request failed: ${raw}`);
      assert(
        response.headers.get('content-type')?.includes('text/event-stream'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );
      assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');

      const eventNames = events.map((event) => event.event);
      assert(
        JSON.stringify(eventNames) ===
          JSON.stringify([
            'message_start',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'message_delta',
            'message_stop',
          ]),
        `Unexpected event sequence: ${JSON.stringify(eventNames)}\nRaw: ${raw}`
      );

      const blockStarts = events.filter((event) => event.event === 'content_block_start');
      const blockDeltas = events.filter((event) => event.event === 'content_block_delta');
      const messageDelta = events.find((event) => event.event === 'message_delta');

      assert(
        blockStarts[0]?.data?.content_block?.type === 'text' && blockStarts[0]?.data?.index === 0,
        `Unexpected text content_block_start: ${JSON.stringify(blockStarts[0])}`
      );
      assert(
        blockDeltas[0]?.data?.delta?.type === 'text_delta' &&
          blockDeltas[0]?.data?.delta?.text === 'Let me check both tools.',
        `Unexpected text delta: ${JSON.stringify(blockDeltas[0])}`
      );
      assert(
        blockStarts[1]?.data?.content_block?.type === 'tool_use' &&
          blockStarts[1]?.data?.index === 1 &&
          blockStarts[1]?.data?.content_block?.id === 'toolu_weather_123' &&
          blockStarts[1]?.data?.content_block?.name === 'get_weather',
        `Unexpected first tool block: ${JSON.stringify(blockStarts[1])}`
      );
      assert(
        blockDeltas[1]?.data?.delta?.type === 'input_json_delta' &&
          blockDeltas[1]?.data?.index === 1 &&
          blockDeltas[1]?.data?.delta?.partial_json === JSON.stringify({ city: 'Shanghai' }),
        `Unexpected first tool delta: ${JSON.stringify(blockDeltas[1])}`
      );
      assert(
        blockStarts[2]?.data?.content_block?.type === 'tool_use' &&
          blockStarts[2]?.data?.index === 2 &&
          blockStarts[2]?.data?.content_block?.id === 'toolu_time_456' &&
          blockStarts[2]?.data?.content_block?.name === 'get_time',
        `Unexpected second tool block: ${JSON.stringify(blockStarts[2])}`
      );
      assert(
        blockDeltas[2]?.data?.delta?.type === 'input_json_delta' &&
          blockDeltas[2]?.data?.index === 2 &&
          blockDeltas[2]?.data?.delta?.partial_json === JSON.stringify({ city: 'Shanghai' }),
        `Unexpected second tool delta: ${JSON.stringify(blockDeltas[2])}`
      );
      assert(
        messageDelta?.data?.delta?.stop_reason === 'tool_use',
        `Unexpected stop_reason: ${JSON.stringify(messageDelta)}`
      );
      assert(
        messageDelta?.data?.usage?.input_tokens === null,
        `Unexpected usage payload: ${JSON.stringify(messageDelta)}`
      );
      assert(
        messageDelta?.data?.usage?.output_tokens === null,
        `Unexpected usage payload: ${JSON.stringify(messageDelta)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            traceId: response.headers.get('x-trace-id'),
            events: eventNames,
            textBlock: blockStarts[0].data.content_block,
            firstToolBlock: blockStarts[1].data.content_block,
            secondToolBlock: blockStarts[2].data.content_block,
            stopReason: messageDelta.data.delta.stop_reason,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
