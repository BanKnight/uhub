// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  withMockJsonUpstream,
} from './_anthropic';

async function callAnthropic(rawKey: string) {
  const response = await fetch(`${WORKER_BASE_URL}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'Use both tools' }],
    }),
  });

  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function main() {
  await withMockJsonUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      return {
        body: JSON.stringify({
          id: 'chatcmpl-anthropic-multi-tool-use-test',
          object: 'chat.completion',
          created: 1710000006,
          model: parsed.model ?? 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Let me check both tools.',
                tool_calls: [
                  {
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
              finish_reason: 'tool_calls',
            },
          ],
        }),
        headers: {
          'content-type': 'application/json',
        },
      };
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const channelId = await createChannel(cookie, {
        name: `anthropic-tool-use-multi-nonstream-${Date.now()}`,
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `anthropic-tool-use-multi-nonstream-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['anthropic_messages'],
      });
      const { response, json } = await callAnthropic(rawKey);

      assert(response.ok, `Multi tool use request failed: ${JSON.stringify(json)}`);
      assert(
        response.headers.get('content-type')?.includes('application/json'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );
      assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');
      assert(json?.type === 'message', `Unexpected response type: ${JSON.stringify(json)}`);
      assert(json?.role === 'assistant', 'Anthropic response role should be assistant');
      assert(Array.isArray(json?.content), 'Anthropic response content should be an array');
      assert(
        json.content.length === 3,
        `Unexpected content length: ${JSON.stringify(json.content)}`
      );
      assert(
        json.content[0]?.type === 'text' && json.content[0]?.text === 'Let me check both tools.',
        `Unexpected first content block: ${JSON.stringify(json.content)}`
      );
      assert(
        json.content[1]?.type === 'tool_use' &&
          json.content[1]?.id === 'toolu_weather_123' &&
          json.content[1]?.name === 'get_weather' &&
          json.content[1]?.input?.city === 'Shanghai',
        `Unexpected first tool_use block: ${JSON.stringify(json.content)}`
      );
      assert(
        json.content[2]?.type === 'tool_use' &&
          json.content[2]?.id === 'toolu_time_456' &&
          json.content[2]?.name === 'get_time' &&
          json.content[2]?.input?.city === 'Shanghai',
        `Unexpected second tool_use block: ${JSON.stringify(json.content)}`
      );
      assert(json.stop_reason === 'tool_use', `Unexpected stop_reason: ${json.stop_reason}`);
      assert(json.stop_sequence === null, `Unexpected stop_sequence: ${json.stop_sequence}`);

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            traceId: response.headers.get('x-trace-id'),
            stopReason: json.stop_reason,
            content: json.content,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
