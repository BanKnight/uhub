// @ts-nocheck
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  withMockJsonUpstream,
  withMockSseUpstream,
} from './_anthropic';

const MODEL = 'gemini-2.5-flash';
const STOP_SEQUENCE = '<STOP>';
const TIMEOUT_DELAY_MS = 1_500;
const RECOVERY_WAIT_MS = 1_100;

function encodeChunk(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function parseSsePayloads(payload: string) {
  return payload
    .split('\n\n')
    .filter(Boolean)
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n')
    )
    .filter(Boolean)
    .map((data) => (data === '[DONE]' ? '[DONE]' : JSON.parse(data)));
}

function buildGeminiBody(stream: boolean) {
  return JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Say hello' }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 64,
      stopSequences: [STOP_SEQUENCE],
    },
    stream,
  });
}

async function fetchGemini(rawKey: string, stream: boolean) {
  const action = stream ? ':streamGenerateContent' : ':generateContent';
  return fetch(`${WORKER_BASE_URL}/v1beta/models/${encodeURIComponent(MODEL)}${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawKey}`,
    },
    body: buildGeminiBody(stream),
  });
}

async function readJson(response: Response) {
  const text = await response.text();
  return {
    text,
    json: text ? JSON.parse(text) : null,
  };
}

async function fetchAuditRequest(traceId: string, cookie: string) {
  const response = await fetch(
    `${WORKER_BASE_URL}/trpc/admin.audit.list?input=${encodeURIComponent(JSON.stringify({ traceId }))}`,
    {
      headers: {
        cookie,
      },
    }
  );
  const json = await response.json();
  assert(response.ok, `Audit query failed: ${JSON.stringify(json)}`);
  return {
    json,
    requestItem: json?.result?.data?.[0] ?? null,
  };
}

async function waitForAuditRequest(
  traceId: string,
  cookie: string,
  predicate: (requestItem: Record<string, unknown>) => boolean,
  timeoutMs = 5_000
) {
  const startedAt = Date.now();
  let lastJson: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    const audit = await fetchAuditRequest(traceId, cookie);
    lastJson = audit.json;

    if (audit.requestItem && predicate(audit.requestItem)) {
      return audit.requestItem;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for audit request: ${JSON.stringify(lastJson)}`);
}

async function withControlledUpstream(
  handler: (body: string, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>
) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    handler(body, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function runHappyPathScenario() {
  return await withMockSseUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      assert(parsed.model === MODEL, `Unexpected model: ${JSON.stringify(parsed)}`);
      assert(parsed.stream === true, `Expected stream=true: ${JSON.stringify(parsed)}`);
      assert(
        parsed.messages?.[0]?.content === 'Say hello',
        `Unexpected messages: ${JSON.stringify(parsed)}`
      );
      assert(
        Array.isArray(parsed.stop) && parsed.stop[0] === STOP_SEQUENCE,
        `Unexpected stop sequence: ${JSON.stringify(parsed)}`
      );

      return [
        encodeChunk({
          id: 'chatcmpl-gemini-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000020,
          model: parsed.model,
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
          id: 'chatcmpl-gemini-stream-test',
          object: 'chat.completion.chunk',
          created: 1710000020,
          model: parsed.model,
          choices: [
            {
              index: 0,
              delta: {
                content: `lo${STOP_SEQUENCE}ignored`,
              },
              finish_reason: 'stop',
            },
          ],
        }),
        'data: [DONE]\n\n',
      ].join('');
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const channelId = await createChannel(cookie, {
        name: `gemini-stream-${Date.now()}`,
        provider: 'gemini',
        protocol: 'gemini_contents',
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `gemini-stream-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['gemini_contents'],
      });

      const response = await fetchGemini(rawKey, true);
      const raw = await response.text();
      const events = parseSsePayloads(raw);

      assert(response.ok, `Gemini stream failed: ${raw}`);
      assert(
        response.headers.get('content-type')?.includes('text/event-stream'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );

      const traceId = response.headers.get('x-trace-id');
      assert(traceId, 'Missing x-trace-id header');
      assert(events.length >= 2, `Expected stream events, got ${raw}`);

      const jsonEvents = events.filter((event) => event !== '[DONE]');
      const streamedText = jsonEvents
        .flatMap((event) => event.candidates ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
      assert(streamedText === 'Hello', `Unexpected streamed text: ${streamedText}`);

      const finalEvent = jsonEvents[jsonEvents.length - 1];
      assert(
        finalEvent?.candidates?.[0]?.finishReason === 'STOP',
        `Unexpected final event: ${JSON.stringify(finalEvent)}`
      );
      assert(
        finalEvent?.usageMetadata?.promptTokenCount === null,
        `Expected promptTokenCount=null: ${JSON.stringify(finalEvent)}`
      );
      assert(
        finalEvent?.usageMetadata?.candidatesTokenCount === null,
        `Expected candidatesTokenCount=null: ${JSON.stringify(finalEvent)}`
      );
      assert(
        finalEvent?.usageMetadata?.totalTokenCount === null,
        `Expected totalTokenCount=null: ${JSON.stringify(finalEvent)}`
      );

      const requestItem = await waitForAuditRequest(
        traceId,
        cookie,
        (item) => item.status === 'completed'
      );
      assert(
        requestItem.endpoint === 'gemini_contents',
        `Unexpected endpoint: ${JSON.stringify(requestItem)}`
      );
      assert(
        requestItem.channelId === channelId,
        `Unexpected channelId: ${JSON.stringify(requestItem)}`
      );
      assert(
        requestItem.status === 'completed',
        `Unexpected status: ${JSON.stringify(requestItem)}`
      );
      assert(
        requestItem.failureClass === null,
        `Unexpected failureClass: ${JSON.stringify(requestItem)}`
      );
      assert(
        requestItem.httpStatus === 200,
        `Unexpected httpStatus: ${JSON.stringify(requestItem)}`
      );

      return {
        scenario: 'happy-path',
        traceId,
        text: streamedText,
        finishReason: finalEvent.candidates[0].finishReason,
        requestStatus: requestItem.status,
      };
    }
  );
}

async function runInterruptedStreamScenario() {
  let primaryHits = 0;
  let secondaryHits = 0;

  return await withControlledUpstream(
    (body, response) => {
      primaryHits += 1;
      const parsed = JSON.parse(body);
      assert(parsed.model === MODEL, `Unexpected model: ${JSON.stringify(parsed)}`);

      if (parsed.stream !== true) {
        response.writeHead(503, {
          'content-type': 'application/json',
        });
        response.end(
          JSON.stringify({
            error: {
              message: 'primary should be skipped after interrupted stream',
            },
          })
        );
        return;
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(
        encodeChunk({
          id: 'chatcmpl-gemini-stream-interrupted',
          object: 'chat.completion.chunk',
          created: 1710000030,
          model: parsed.model,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'partial',
              },
              finish_reason: null,
            },
          ],
        })
      );
      setTimeout(() => response.destroy(new Error('stream interrupted for test')), 20);
    },
    async (primaryBaseUrl) => {
      return await withMockJsonUpstream(
        (body) => {
          secondaryHits += 1;
          const parsed = JSON.parse(body);
          return {
            body: JSON.stringify({
              id: 'chatcmpl-gemini-stream-recovery',
              object: 'chat.completion',
              created: 1710000031,
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
            }),
            headers: {
              'content-type': 'application/json',
            },
          };
        },
        async (secondaryBaseUrl) => {
          const cookie = await ensureAdminSession();
          const primaryChannelId = await createChannel(cookie, {
            name: `gemini-stream-interrupted-primary-${Date.now()}`,
            baseUrl: primaryBaseUrl,
            provider: 'gemini',
            protocol: 'gemini_contents',
          });
          const secondaryChannelId = await createChannel(cookie, {
            name: `gemini-stream-interrupted-secondary-${Date.now()}`,
            baseUrl: secondaryBaseUrl,
            provider: 'gemini',
            protocol: 'gemini_contents',
          });
          const rawKey = await createApiKey(cookie, {
            label: `gemini-stream-interrupted-key-${Date.now()}`,
            channelIds: [primaryChannelId, secondaryChannelId],
            endpointRules: ['gemini_contents'],
            maxConcurrency: 1,
          });

          const interruptedResponse = await fetchGemini(rawKey, true);
          const interruptedTraceId = interruptedResponse.headers.get('x-trace-id');
          assert(interruptedResponse.ok, 'Interrupted stream should start successfully');
          assert(interruptedTraceId, 'Missing interrupted trace id');
          await interruptedResponse.text().catch(() => '');

          const interruptedRequest = await waitForAuditRequest(
            interruptedTraceId,
            cookie,
            (item) => item.status === 'failed'
          );
          assert(
            interruptedRequest.failureClass === 'network_error',
            `Unexpected interrupted failureClass: ${JSON.stringify(interruptedRequest)}`
          );
          assert(
            interruptedRequest.channelId === primaryChannelId,
            `Unexpected interrupted channelId: ${JSON.stringify(interruptedRequest)}`
          );
          assert(
            interruptedRequest.httpStatus === 200,
            `Unexpected interrupted httpStatus: ${JSON.stringify(interruptedRequest)}`
          );

          await new Promise((resolve) => setTimeout(resolve, 50));

          const recoveryResponse = await fetchGemini(rawKey, false);
          const recovery = await readJson(recoveryResponse);
          assert(recoveryResponse.ok, `Recovery request failed: ${recovery.text}`);
          assert(
            recovery.json?.candidates?.[0]?.content?.parts?.[0]?.text === 'served-by-secondary',
            `Unexpected recovery payload: ${JSON.stringify(recovery.json)}`
          );
          assert(secondaryHits === 1, `Expected secondaryHits=1, got ${secondaryHits}`);

          return {
            scenario: 'interrupted-stream',
            interruptedTraceId,
            interruptedStatus: interruptedRequest.status,
            interruptedFailureClass: interruptedRequest.failureClass,
            primaryHits,
            secondaryHits,
            recoveryText: recovery.json.candidates[0].content.parts[0].text,
          };
        }
      );
    }
  );
}

async function runTimeoutScenario() {
  let timeoutHits = 0;

  return await withControlledUpstream(
    (body, response) => {
      timeoutHits += 1;
      const parsed = JSON.parse(body);
      assert(parsed.model === MODEL, `Unexpected model: ${JSON.stringify(parsed)}`);

      if (timeoutHits === 1) {
        assert(
          parsed.stream === true,
          `Expected first request stream=true: ${JSON.stringify(parsed)}`
        );
        setTimeout(() => {
          response.destroy();
        }, TIMEOUT_DELAY_MS);
        return;
      }

      assert(
        parsed.stream === false,
        `Expected recovery request stream=false: ${JSON.stringify(parsed)}`
      );
      response.writeHead(200, {
        'content-type': 'application/json',
      });
      response.end(
        JSON.stringify({
          id: 'chatcmpl-gemini-timeout-recovery',
          object: 'chat.completion',
          created: 1710000032,
          model: parsed.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'served-after-timeout',
              },
              finish_reason: 'stop',
            },
          ],
        })
      );
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const channelId = await createChannel(cookie, {
        name: `gemini-stream-timeout-${Date.now()}`,
        baseUrl,
        provider: 'gemini',
        protocol: 'gemini_contents',
      });
      const rawKey = await createApiKey(cookie, {
        label: `gemini-stream-timeout-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['gemini_contents'],
        maxConcurrency: 1,
      });

      const timeoutResponse = await fetchGemini(rawKey, true);
      const timeoutTraceId = timeoutResponse.headers.get('x-trace-id');
      const timeoutResult = await readJson(timeoutResponse);

      assert(timeoutResponse.status === 504, `Expected timeout status 504: ${timeoutResult.text}`);
      assert(timeoutTraceId, 'Missing timeout trace id');
      assert(
        timeoutResult.json?.error?.type === 'upstream_timeout',
        `Unexpected timeout payload: ${JSON.stringify(timeoutResult.json)}`
      );

      const timeoutRequest = await waitForAuditRequest(
        timeoutTraceId,
        cookie,
        (item) => item.status === 'failed' && item.failureClass === 'upstream_timeout'
      );
      assert(
        timeoutRequest.channelId === channelId,
        `Unexpected timeout channelId: ${JSON.stringify(timeoutRequest)}`
      );
      assert(
        timeoutRequest.httpStatus === null,
        `Unexpected timeout httpStatus: ${JSON.stringify(timeoutRequest)}`
      );
      assert(timeoutHits === 1, `Expected timeoutHits=1 after first request, got ${timeoutHits}`);

      await new Promise((resolve) => setTimeout(resolve, RECOVERY_WAIT_MS));

      const recoveryResponse = await fetchGemini(rawKey, false);
      const recovery = await readJson(recoveryResponse);
      assert(recoveryResponse.ok, `Timeout recovery request failed: ${recovery.text}`);
      assert(
        recovery.json?.candidates?.[0]?.content?.parts?.[0]?.text === 'served-after-timeout',
        `Unexpected timeout recovery payload: ${JSON.stringify(recovery.json)}`
      );
      assert(timeoutHits === 2, `Expected timeoutHits=2 after recovery, got ${timeoutHits}`);

      return {
        scenario: 'upstream-timeout',
        timeoutTraceId,
        timeoutStatus: timeoutRequest.status,
        timeoutFailureClass: timeoutRequest.failureClass,
        timeoutHits,
        recoveryText: recovery.json.candidates[0].content.parts[0].text,
      };
    }
  );
}

async function main() {
  const results = [
    await runHappyPathScenario(),
    await runInterruptedStreamScenario(),
    await runTimeoutScenario(),
  ];

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        workerBaseUrl: WORKER_BASE_URL,
        results,
      },
      null,
      2
    )
  );
}

await main();
