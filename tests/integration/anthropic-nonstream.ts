// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  withMockJsonUpstream,
} from './_anthropic';

const STOP_SEQUENCE = '<STOP>';

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
      stop_sequences: [STOP_SEQUENCE],
      messages: [{ role: 'user', content: 'Say hello' }],
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
          id: 'chatcmpl-anthropic-nonstream-test',
          object: 'chat.completion',
          created: 1710000000,
          model: parsed.model ?? 'gpt-4o-mini',
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
        }),
        headers: {
          'content-type': 'application/json',
        },
      };
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const channelId = await createChannel(cookie, {
        name: `anthropic-nonstream-${Date.now()}`,
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `anthropic-nonstream-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['anthropic_messages'],
      });
      const { response, json } = await callAnthropic(rawKey);

      assert(response.ok, `Anthropic request failed: ${JSON.stringify(json)}`);
      assert(
        response.headers.get('content-type')?.includes('application/json'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );
      assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');
      assert(json?.type === 'message', `Unexpected response type: ${JSON.stringify(json)}`);
      assert(json?.role === 'assistant', 'Anthropic response role should be assistant');
      assert(Array.isArray(json?.content), 'Anthropic response content should be an array');
      assert(
        json.content[0]?.type === 'text',
        `Unexpected first content block: ${JSON.stringify(json.content)}`
      );
      assert(
        json.content[0]?.text === 'Hello',
        `Unexpected translated text: ${JSON.stringify(json.content)}`
      );
      assert(json?.stop_reason === 'stop_sequence', `Unexpected stop_reason: ${json?.stop_reason}`);
      assert(
        json?.stop_sequence === STOP_SEQUENCE,
        `Unexpected stop_sequence: ${json?.stop_sequence}`
      );
      assert(
        typeof json?.usage?.input_tokens === 'number' && json.usage.input_tokens > 0,
        'input_tokens should be > 0'
      );
      assert(
        typeof json?.usage?.output_tokens === 'number' && json.usage.output_tokens > 0,
        'output_tokens should be > 0'
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            workerBaseUrl: WORKER_BASE_URL,
            upstreamBaseUrl: baseUrl,
            traceId: response.headers.get('x-trace-id'),
            text: json.content[0].text,
            stopReason: json.stop_reason,
            stopSequence: json.stop_sequence,
            usage: json.usage,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
