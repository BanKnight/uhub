// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
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

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            workerBaseUrl: WORKER_BASE_URL,
            upstreamBaseUrl: baseUrl,
            traceId: response.headers.get('x-trace-id'),
            text: json.choices[0].message.content,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
