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
      messages: [{ role: 'user', content: 'Say hello with failover' }],
    }),
  });

  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function main() {
  let primaryHits = 0;
  let secondaryHits = 0;

  await withMockJsonUpstream(
    () => {
      primaryHits += 1;
      return {
        status: 503,
        body: JSON.stringify({
          error: {
            message: 'primary unavailable',
          },
        }),
        headers: {
          'content-type': 'application/json',
        },
      };
    },
    async (primaryBaseUrl) => {
      await withMockJsonUpstream(
        (body) => {
          secondaryHits += 1;
          const parsed = JSON.parse(body);
          return {
            body: JSON.stringify({
              id: 'chatcmpl-anthropic-failover-test',
              object: 'chat.completion',
              created: 1710000003,
              model: parsed.model ?? 'gpt-4o-mini',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'served-by-secondary',
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
        async (secondaryBaseUrl) => {
          const cookie = await ensureAdminSession();
          const primaryChannelId = await createChannel(cookie, {
            name: `anthropic-failover-primary-${Date.now()}`,
            baseUrl: primaryBaseUrl,
          });
          const secondaryChannelId = await createChannel(cookie, {
            name: `anthropic-failover-secondary-${Date.now()}`,
            baseUrl: secondaryBaseUrl,
          });
          const rawKey = await createApiKey(cookie, {
            label: `anthropic-failover-key-${Date.now()}`,
            channelIds: [primaryChannelId, secondaryChannelId],
            endpointRules: ['anthropic_messages'],
          });
          const { response, json } = await callAnthropic(rawKey);

          assert(response.ok, `Failover request failed: ${JSON.stringify(json)}`);
          assert(
            response.headers.get('content-type')?.includes('application/json'),
            `Unexpected content-type: ${response.headers.get('content-type')}`
          );
          assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');
          assert(json?.type === 'message', `Unexpected response type: ${JSON.stringify(json)}`);
          assert(
            json?.content?.[0]?.type === 'text' && json.content[0].text === 'served-by-secondary',
            `Unexpected failover response body: ${JSON.stringify(json)}`
          );
          assert(primaryHits === 1, `Expected primaryHits=1, got ${primaryHits}`);
          assert(secondaryHits === 1, `Expected secondaryHits=1, got ${secondaryHits}`);

          console.log(
            JSON.stringify(
              {
                status: 'ok',
                traceId: response.headers.get('x-trace-id'),
                primaryHits,
                secondaryHits,
                text: json.content[0].text,
              },
              null,
              2
            )
          );
        }
      );
    }
  );
}

await main();
