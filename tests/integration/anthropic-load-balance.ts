// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  requestJson,
  withMockJsonUpstream,
} from './_anthropic';

const MODEL = 'claude-3-5-sonnet-latest';

function hashStringToUint32(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function findTraceIdForOffset(offset: number, channelCount: number) {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const traceId = `anthropic-load-balance-${offset}-${attempt}`;
    if (hashStringToUint32(traceId) % channelCount === offset) {
      return traceId;
    }
  }

  throw new Error(`Failed to find traceId for offset ${offset}/${channelCount}`);
}

async function callAnthropic(rawKey: string, traceId: string) {
  const response = await fetch(`${WORKER_BASE_URL}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawKey}`,
      'x-trace-id': traceId,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 128,
      messages: [{ role: 'user', content: `Respond for ${traceId}` }],
    }),
  });

  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function listAuditByTraceId(cookie: string, traceId: string) {
  const audit = await requestJson(
    `/trpc/admin.audit.list?input=${encodeURIComponent(JSON.stringify({ traceId, limit: 10 }))}`,
    { method: 'GET' },
    cookie
  );

  assert(audit.response.ok, `Audit failed: ${JSON.stringify(audit.json)}`);
  return (audit.json?.result?.data ?? []) as Array<{
    traceId: string | null;
    channelId: string | null;
    channelName: string | null;
    endpoint: string;
    status: string;
    failureClass: string | null;
    httpStatus: number | null;
  }>;
}

async function main() {
  let primaryHits = 0;
  let secondaryHits = 0;

  await withMockJsonUpstream(
    (body) => {
      primaryHits += 1;
      const parsed = JSON.parse(body);
      assert(parsed.model === MODEL, `Unexpected primary model: ${JSON.stringify(parsed)}`);

      return {
        body: JSON.stringify({
          id: `chatcmpl-anthropic-load-balance-primary-${primaryHits}`,
          object: 'chat.completion',
          created: 1710000041,
          model: parsed.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'served-by-primary',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 4,
            total_tokens: 9,
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
          assert(parsed.model === MODEL, `Unexpected secondary model: ${JSON.stringify(parsed)}`);

          return {
            body: JSON.stringify({
              id: `chatcmpl-anthropic-load-balance-secondary-${secondaryHits}`,
              object: 'chat.completion',
              created: 1710000042,
              model: parsed.model,
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
              usage: {
                prompt_tokens: 5,
                completion_tokens: 4,
                total_tokens: 9,
              },
            }),
            headers: {
              'content-type': 'application/json',
            },
          };
        },
        async (secondaryBaseUrl) => {
          const cookie = await ensureAdminSession();
          const primaryChannelId = await createChannel(cookie, {
            name: `anthropic-load-balance-primary-${Date.now()}`,
            provider: 'anthropic',
            protocol: 'anthropic_messages',
            baseUrl: primaryBaseUrl,
          });
          const secondaryChannelId = await createChannel(cookie, {
            name: `anthropic-load-balance-secondary-${Date.now()}`,
            provider: 'anthropic',
            protocol: 'anthropic_messages',
            baseUrl: secondaryBaseUrl,
          });
          const rawKey = await createApiKey(cookie, {
            label: `anthropic-load-balance-key-${Date.now()}`,
            channelIds: [primaryChannelId, secondaryChannelId],
            endpointRules: ['anthropic_messages'],
          });

          const primaryTraceId = findTraceIdForOffset(0, 2);
          const secondaryTraceId = findTraceIdForOffset(1, 2);

          const primaryResultA = await callAnthropic(rawKey, primaryTraceId);
          assert(
            primaryResultA.response.ok,
            `Primary trace request A failed: ${JSON.stringify(primaryResultA.json)}`
          );
          assert(
            primaryResultA.response.headers.get('x-trace-id') === primaryTraceId,
            `Unexpected primary trace echo: ${primaryResultA.response.headers.get('x-trace-id')}`
          );
          assert(
            primaryResultA.json?.content?.[0]?.text === 'served-by-primary',
            `Unexpected primary response A: ${JSON.stringify(primaryResultA.json)}`
          );

          const secondaryResultA = await callAnthropic(rawKey, secondaryTraceId);
          assert(
            secondaryResultA.response.ok,
            `Secondary trace request A failed: ${JSON.stringify(secondaryResultA.json)}`
          );
          assert(
            secondaryResultA.response.headers.get('x-trace-id') === secondaryTraceId,
            `Unexpected secondary trace echo: ${secondaryResultA.response.headers.get('x-trace-id')}`
          );
          assert(
            secondaryResultA.json?.content?.[0]?.text === 'served-by-secondary',
            `Unexpected secondary response A: ${JSON.stringify(secondaryResultA.json)}`
          );

          const primaryResultB = await callAnthropic(rawKey, primaryTraceId);
          assert(
            primaryResultB.response.ok,
            `Primary trace request B failed: ${JSON.stringify(primaryResultB.json)}`
          );
          assert(
            primaryResultB.json?.content?.[0]?.text === 'served-by-primary',
            `Unexpected primary response B: ${JSON.stringify(primaryResultB.json)}`
          );

          const secondaryResultB = await callAnthropic(rawKey, secondaryTraceId);
          assert(
            secondaryResultB.response.ok,
            `Secondary trace request B failed: ${JSON.stringify(secondaryResultB.json)}`
          );
          assert(
            secondaryResultB.json?.content?.[0]?.text === 'served-by-secondary',
            `Unexpected secondary response B: ${JSON.stringify(secondaryResultB.json)}`
          );

          assert(primaryHits === 2, `Expected primaryHits=2, got ${primaryHits}`);
          assert(secondaryHits === 2, `Expected secondaryHits=2, got ${secondaryHits}`);

          const primaryAuditItems = await listAuditByTraceId(cookie, primaryTraceId);
          assert(
            primaryAuditItems.length === 2,
            `Unexpected primary audit: ${JSON.stringify(primaryAuditItems)}`
          );
          assert(
            primaryAuditItems.every(
              (item) =>
                item.traceId === primaryTraceId &&
                item.channelId === primaryChannelId &&
                item.endpoint === 'anthropic_messages' &&
                item.status === 'completed' &&
                item.failureClass === null &&
                item.httpStatus === 200
            ),
            `Unexpected primary audit items: ${JSON.stringify(primaryAuditItems)}`
          );

          const secondaryAuditItems = await listAuditByTraceId(cookie, secondaryTraceId);
          assert(
            secondaryAuditItems.length === 2,
            `Unexpected secondary audit: ${JSON.stringify(secondaryAuditItems)}`
          );
          assert(
            secondaryAuditItems.every(
              (item) =>
                item.traceId === secondaryTraceId &&
                item.channelId === secondaryChannelId &&
                item.endpoint === 'anthropic_messages' &&
                item.status === 'completed' &&
                item.failureClass === null &&
                item.httpStatus === 200
            ),
            `Unexpected secondary audit items: ${JSON.stringify(secondaryAuditItems)}`
          );

          console.log(
            JSON.stringify(
              {
                status: 'ok',
                workerBaseUrl: WORKER_BASE_URL,
                primaryTraceId,
                secondaryTraceId,
                primaryChannelId,
                secondaryChannelId,
                primaryHits,
                secondaryHits,
                primaryAuditItems,
                secondaryAuditItems,
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
