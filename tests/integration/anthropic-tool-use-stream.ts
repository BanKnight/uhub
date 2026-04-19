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
      messages: [{ role: 'user', content: 'Use a tool' }],
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
          id: 'chatcmpl-anthropic-tool-use-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000004,
          model: parsed.model ?? 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'toolu_mock_stream_123',
                    type: 'function',
                    function: {
                      name: 'get_weather',
                      arguments: JSON.stringify({
                        city: 'Shanghai',
                        unit: 'celsius',
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
          id: 'chatcmpl-anthropic-tool-use-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000004,
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
        name: `anthropic-tool-use-stream-${Date.now()}`,
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `anthropic-tool-use-stream-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['anthropic_messages'],
      });
      const { response, events, raw } = await callAnthropicStream(rawKey);

      assert(response.ok, `Stream tool_use request failed: ${raw}`);
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
            'message_delta',
            'message_stop',
          ]),
        `Unexpected event sequence: ${JSON.stringify(eventNames)}\nRaw: ${raw}`
      );

      const toolUseStart = events.find((event) => event.event === 'content_block_start');
      const toolUseDelta = events.find((event) => event.event === 'content_block_delta');
      const messageDelta = events.find((event) => event.event === 'message_delta');

      assert(
        toolUseStart?.data?.content_block?.type === 'tool_use',
        `Unexpected content_block_start: ${JSON.stringify(toolUseStart)}`
      );
      assert(
        toolUseStart?.data?.content_block?.id === 'toolu_mock_stream_123',
        `Unexpected tool_use id: ${JSON.stringify(toolUseStart)}`
      );
      assert(
        toolUseStart?.data?.content_block?.name === 'get_weather',
        `Unexpected tool_use name: ${JSON.stringify(toolUseStart)}`
      );
      assert(
        toolUseDelta?.data?.delta?.type === 'input_json_delta',
        `Unexpected content_block_delta: ${JSON.stringify(toolUseDelta)}`
      );
      assert(
        toolUseDelta?.data?.delta?.partial_json ===
          JSON.stringify({ city: 'Shanghai', unit: 'celsius' }),
        `Unexpected partial_json: ${JSON.stringify(toolUseDelta)}`
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
            toolUse: toolUseStart.data.content_block,
            partialJson: toolUseDelta.data.delta.partial_json,
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
