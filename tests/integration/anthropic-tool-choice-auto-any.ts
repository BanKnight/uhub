// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  withMockJsonUpstream,
} from './_anthropic';

const TOOL_DEFINITION = {
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
};

async function callAnthropic(rawKey: string, toolChoice: { type: 'auto' | 'any' }) {
  const response = await fetch(`${WORKER_BASE_URL}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 128,
      tool_choice: toolChoice,
      tools: [TOOL_DEFINITION],
      messages: [{ role: 'user', content: `Run with tool_choice=${toolChoice.type}` }],
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
      const expectedToolChoice = parsed.messages?.[0]?.content?.includes('tool_choice=any')
        ? 'required'
        : 'auto';

      assert(Array.isArray(parsed.tools), `Missing tools payload: ${JSON.stringify(parsed)}`);
      assert(parsed.tools.length === 1, `Unexpected tools length: ${JSON.stringify(parsed.tools)}`);
      assert(
        parsed.tools[0]?.type === 'function' && parsed.tools[0]?.function?.name === 'get_weather',
        `Unexpected tools payload: ${JSON.stringify(parsed.tools)}`
      );
      assert(
        parsed.tool_choice === expectedToolChoice,
        `Unexpected tool_choice mapping: ${JSON.stringify(parsed.tool_choice)}`
      );

      return {
        body: JSON.stringify({
          id: `chatcmpl-anthropic-tool-choice-${expectedToolChoice}`,
          object: 'chat.completion',
          created: 1710000008,
          model: parsed.model ?? 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: `toolu_${expectedToolChoice}_123`,
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
        name: `anthropic-tool-choice-auto-any-${Date.now()}`,
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `anthropic-tool-choice-auto-any-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['anthropic_messages'],
      });

      for (const toolChoiceType of ['auto', 'any']) {
        const { response, json } = await callAnthropic(rawKey, { type: toolChoiceType });

        assert(
          response.ok,
          `tool_choice=${toolChoiceType} request failed: ${JSON.stringify(json)}`
        );
        assert(
          response.headers.get('content-type')?.includes('application/json'),
          `Unexpected content-type for ${toolChoiceType}: ${response.headers.get('content-type')}`
        );
        assert(
          response.headers.get('x-trace-id'),
          `Missing x-trace-id header for ${toolChoiceType}`
        );
        assert(
          json?.type === 'message',
          `Unexpected response type for ${toolChoiceType}: ${JSON.stringify(json)}`
        );
        assert(
          json?.stop_reason === 'tool_use',
          `Unexpected stop_reason for ${toolChoiceType}: ${json?.stop_reason}`
        );
        assert(
          json?.content?.[0]?.type === 'tool_use' && json.content[0]?.name === 'get_weather',
          `Unexpected translated tool_use for ${toolChoiceType}: ${JSON.stringify(json?.content)}`
        );
      }

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            cases: ['auto', 'any'],
          },
          null,
          2
        )
      );
    }
  );
}

await main();
