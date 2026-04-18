import {
  type ChatMessage,
  chatCompletionsResponseSchema,
  geminiContentsRequestSchema,
} from '@uhub/shared';
import { Hono } from 'hono';
import type { WorkerEnv } from '../../index';
import { getTraceId } from '../../services/request-log/request-log';
import { createGatewayErrorResponse } from './error-response';
import { proxyGatewayRequest } from './proxy-request';

const GEMINI_CONTENTS_ENDPOINT = 'gemini_contents';
const GEMINI_MODELS_PREFIX = '/v1beta/models/';
const GEMINI_GENERATE_CONTENT_SUFFIX = ':generateContent';

export const geminiContentsRouter = new Hono<{ Bindings: WorkerEnv }>();

function normalizeGeminiParts(parts: Array<{ text: string }>) {
  return parts.map((part) => part.text).join('\n');
}

function toOpenAiMessages(
  systemInstruction: { parts: Array<{ text: string }> } | undefined,
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
): ChatMessage[] {
  const messages = contents.map((content) => ({
    role: content.role === 'model' ? 'assistant' : 'user',
    content: normalizeGeminiParts(content.parts),
  })) satisfies ChatMessage[];

  if (!systemInstruction) {
    return messages;
  }

  return [{ role: 'system', content: normalizeGeminiParts(systemInstruction.parts) }, ...messages];
}

function extractModelFromPath(pathname: string) {
  if (
    !pathname.startsWith(GEMINI_MODELS_PREFIX) ||
    !pathname.endsWith(GEMINI_GENERATE_CONTENT_SUFFIX)
  ) {
    return null;
  }

  const encodedModel = pathname.slice(
    GEMINI_MODELS_PREFIX.length,
    -GEMINI_GENERATE_CONTENT_SUFFIX.length
  );

  return encodedModel ? decodeURIComponent(encodedModel) : null;
}

function applyStopSequences(text: string, stopSequences: string[] | undefined) {
  if (!stopSequences || stopSequences.length === 0) {
    return text;
  }

  for (const stopSequence of stopSequences) {
    const index = text.indexOf(stopSequence);
    if (index !== -1) {
      return text.slice(0, index);
    }
  }

  return text;
}

function estimateGeminiUsage(input: { requestBody: string; responseText: string }) {
  const encoder = new TextEncoder();
  const promptTokenCount = Math.max(1, Math.ceil(encoder.encode(input.requestBody).byteLength / 4));
  const candidatesTokenCount = Math.max(
    1,
    Math.ceil(encoder.encode(input.responseText).byteLength / 4)
  );

  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount: promptTokenCount + candidatesTokenCount,
  };
}

function mapFinishReason(finishReason: string | null | undefined) {
  if (finishReason === 'stop' || !finishReason) {
    return 'STOP';
  }

  if (finishReason === 'length') {
    return 'MAX_TOKENS';
  }

  return finishReason.toUpperCase();
}

geminiContentsRouter.post('/models/*', async (c) => {
  const traceId = getTraceId(c.req.raw);
  const rawBody = await c.req.text();
  const pathname = new URL(c.req.url).pathname;
  const pathModel = extractModelFromPath(pathname);

  if (!pathModel) {
    return createGatewayErrorResponse(
      'invalid_request',
      'Invalid Gemini generateContent path',
      traceId,
      400
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return createGatewayErrorResponse(
      'invalid_request',
      'Request body must be valid JSON',
      traceId,
      400
    );
  }

  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    return createGatewayErrorResponse(
      'invalid_request',
      'Invalid gemini contents request',
      traceId,
      400
    );
  }

  const bodyModel =
    'model' in parsedJson && typeof parsedJson.model === 'string' ? parsedJson.model : undefined;

  if (bodyModel && bodyModel !== pathModel) {
    return createGatewayErrorResponse(
      'invalid_request',
      'Path model does not match request model',
      traceId,
      400
    );
  }

  const parsed = geminiContentsRequestSchema.safeParse({
    ...parsedJson,
    model: pathModel,
  });
  if (!parsed.success) {
    return createGatewayErrorResponse(
      'invalid_request',
      'Invalid gemini contents request',
      traceId,
      400
    );
  }

  if (parsed.data.stream === true) {
    return createGatewayErrorResponse(
      'invalid_request',
      'Gemini streaming is not supported yet',
      traceId,
      400
    );
  }

  const upstreamBody = JSON.stringify({
    model: parsed.data.model,
    messages: toOpenAiMessages(parsed.data.systemInstruction, parsed.data.contents),
    temperature: parsed.data.generationConfig?.temperature,
    top_p: parsed.data.generationConfig?.topP,
    max_tokens: parsed.data.generationConfig?.maxOutputTokens,
    stop: parsed.data.generationConfig?.stopSequences,
    stream: false,
  });

  return proxyGatewayRequest({
    c,
    endpoint: GEMINI_CONTENTS_ENDPOINT,
    model: parsed.data.model,
    rawBody: upstreamBody,
    allowStream: false,
    onSuccess: ({ responseBody, traceId: upstreamTraceId }) => {
      let parsedResponseJson: unknown;
      try {
        parsedResponseJson = JSON.parse(responseBody);
      } catch {
        return createGatewayErrorResponse(
          'network_error',
          'Gateway response translation failed',
          upstreamTraceId,
          502
        );
      }

      const parsedResponse = chatCompletionsResponseSchema.safeParse(parsedResponseJson);
      if (!parsedResponse.success) {
        return createGatewayErrorResponse(
          'network_error',
          'Gateway response translation failed',
          upstreamTraceId,
          502
        );
      }

      const firstChoice = parsedResponse.data.choices[0];
      const rawText =
        typeof firstChoice?.message?.content === 'string' ? firstChoice.message.content : '';
      const text = applyStopSequences(rawText, parsed.data.generationConfig?.stopSequences);

      if (!text) {
        return createGatewayErrorResponse(
          'network_error',
          'Gateway response translation failed',
          upstreamTraceId,
          502
        );
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text }],
              },
              finishReason: mapFinishReason(
                firstChoice?.finishReason ?? firstChoice?.finish_reason ?? null
              ),
            },
          ],
          usageMetadata: estimateGeminiUsage({
            requestBody: rawBody,
            responseText: text,
          }),
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-trace-id': upstreamTraceId,
          },
        }
      );
    },
  });
});
