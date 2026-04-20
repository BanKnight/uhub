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
      tool_choice: {
        type: 'tool',
        name: 'get_weather',
      },
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather by city',
          input_schema: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
              },
            },
            required: ['city'],
          },
        },
      ],
      messages: [
        { role: 'user', content: 'Use the weather tool for Shanghai' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_prev_123',
              name: 'get_weather',
              input: {
                city: 'Shanghai',
              },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_prev_123',
              content: '22C and sunny',
            },
          ],
        },
      ],
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

      assert(Array.isArray(parsed.tools), `Missing tools payload: ${JSON.stringify(parsed)}`);
      assert(parsed.tools.length === 1, `Unexpected tools length: ${JSON.stringify(parsed.tools)}`);
      assert(
        parsed.tools[0]?.type === 'function',
        `Unexpected tool type: ${JSON.stringify(parsed.tools)}`
      );
      assert(
        parsed.tools[0]?.function?.name === 'get_weather',
        `Unexpected tool name: ${JSON.stringify(parsed.tools)}`
      );
      assert(
        parsed.tools[0]?.function?.description === 'Get weather by city',
        `Unexpected tool description: ${JSON.stringify(parsed.tools)}`
      );
      assert(
        parsed.tools[0]?.function?.parameters?.type === 'object',
        `Unexpected tool parameters: ${JSON.stringify(parsed.tools)}`
      );
      assert(
        parsed.tool_choice?.type === 'function' &&
          parsed.tool_choice?.function?.name === 'get_weather',
        `Unexpected tool_choice: ${JSON.stringify(parsed.tool_choice)}`
      );
      assert(Array.isArray(parsed.messages), `Missing messages payload: ${JSON.stringify(parsed)}`);
      assert(
        parsed.messages[0]?.role === 'user' &&
          parsed.messages[0]?.content === 'Use the weather tool for Shanghai',
        `Unexpected first message: ${JSON.stringify(parsed.messages)}`
      );
      assert(
        parsed.messages[1]?.role === 'assistant' &&
          parsed.messages[1]?.content ===
            '[tool_use:toolu_prev_123:get_weather] {"city":"Shanghai"}',
        `Unexpected assistant tool_use message: ${JSON.stringify(parsed.messages)}`
      );
      assert(
        parsed.messages[2]?.role === 'user' &&
          parsed.messages[2]?.content === '[tool_result:toolu_prev_123] 22C and sunny',
        `Unexpected tool_result message: ${JSON.stringify(parsed.messages)}`
      );

      return {
        body: JSON.stringify({
          id: 'chatcmpl-anthropic-tools-request-test',
          object: 'chat.completion',
          created: 1710000005,
          model: parsed.model ?? 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'toolu_mock_request_123',
                    type: 'function',
                    function: {
                      name: 'get_weather',
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
        name: `anthropic-tools-request-${Date.now()}`,
        provider: 'anthropic',
        protocol: 'anthropic_messages',
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `anthropic-tools-request-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['anthropic_messages'],
      });
      const { response, json } = await callAnthropic(rawKey);

      assert(response.ok, `Tools request failed: ${JSON.stringify(json)}`);
      assert(
        response.headers.get('content-type')?.includes('application/json'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );
      assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');
      assert(json?.type === 'message', `Unexpected response type: ${JSON.stringify(json)}`);
      assert(json?.stop_reason === 'tool_use', `Unexpected stop_reason: ${json?.stop_reason}`);
      assert(Array.isArray(json?.content), 'Anthropic response content should be an array');
      assert(
        json.content[0]?.type === 'tool_use' && json.content[0]?.name === 'get_weather',
        `Unexpected translated content: ${JSON.stringify(json?.content)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            traceId: response.headers.get('x-trace-id'),
            stopReason: json.stop_reason,
            translatedToolUse: json.content[0],
          },
          null,
          2
        )
      );
    }
  );
}

await main();
