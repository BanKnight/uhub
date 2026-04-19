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
const MODEL = 'gemini-2.5-flash';

async function callGemini(rawKey: string) {
  const response = await fetch(
    `${WORKER_BASE_URL}/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${rawKey}`,
      },
      body: JSON.stringify({
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
      }),
    }
  );

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
      assert(parsed.model === MODEL, `Unexpected model: ${JSON.stringify(parsed)}`);
      assert(
        parsed.messages?.[0]?.role === 'user',
        `Unexpected messages: ${JSON.stringify(parsed)}`
      );
      assert(
        parsed.messages?.[0]?.content === 'Say hello',
        `Unexpected messages: ${JSON.stringify(parsed)}`
      );
      assert(parsed.max_tokens === 64, `Unexpected max_tokens: ${JSON.stringify(parsed)}`);
      assert(
        Array.isArray(parsed.stop) && parsed.stop[0] === STOP_SEQUENCE,
        `Unexpected stop sequence: ${JSON.stringify(parsed)}`
      );

      return {
        body: JSON.stringify({
          id: 'chatcmpl-gemini-nonstream-test',
          object: 'chat.completion',
          created: 1710000010,
          model: parsed.model,
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
        name: `gemini-nonstream-${Date.now()}`,
        baseUrl,
      });
      const rawKey = await createApiKey(cookie, {
        label: `gemini-nonstream-key-${Date.now()}`,
        channelIds: [channelId],
        endpointRules: ['gemini_contents'],
      });

      const { response, json } = await callGemini(rawKey);

      assert(response.ok, `Gemini request failed: ${JSON.stringify(json)}`);
      assert(
        response.headers.get('content-type')?.includes('application/json'),
        `Unexpected content-type: ${response.headers.get('content-type')}`
      );
      assert(response.headers.get('x-trace-id'), 'Missing x-trace-id header');
      assert(Array.isArray(json?.candidates), `Unexpected candidates: ${JSON.stringify(json)}`);
      assert(
        json.candidates[0]?.content?.role === 'model',
        `Unexpected role: ${JSON.stringify(json)}`
      );
      assert(
        json.candidates[0]?.content?.parts?.[0]?.text === 'Hello',
        `Unexpected translated text: ${JSON.stringify(json)}`
      );
      assert(
        json.candidates[0]?.finishReason === 'STOP',
        `Unexpected finishReason: ${json.candidates[0]?.finishReason}`
      );
      assert(
        json?.usageMetadata?.promptTokenCount === null,
        `Expected promptTokenCount=null: ${JSON.stringify(json)}`
      );
      assert(
        json?.usageMetadata?.candidatesTokenCount === null,
        `Expected candidatesTokenCount=null: ${JSON.stringify(json)}`
      );
      assert(
        json?.usageMetadata?.totalTokenCount === null,
        `Expected totalTokenCount=null: ${JSON.stringify(json)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            workerBaseUrl: WORKER_BASE_URL,
            upstreamBaseUrl: baseUrl,
            traceId: response.headers.get('x-trace-id'),
            text: json.candidates[0].content.parts[0].text,
            finishReason: json.candidates[0].finishReason,
            usageMetadata: json.usageMetadata,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
