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
const GEMINI_STREAM_GENERATE_CONTENT_SUFFIX = ':streamGenerateContent';

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

function extractGeminiTarget(pathname: string) {
  if (!pathname.startsWith(GEMINI_MODELS_PREFIX)) {
    return null;
  }

  if (pathname.endsWith(GEMINI_STREAM_GENERATE_CONTENT_SUFFIX)) {
    const encodedModel = pathname.slice(
      GEMINI_MODELS_PREFIX.length,
      -GEMINI_STREAM_GENERATE_CONTENT_SUFFIX.length
    );
    return encodedModel
      ? {
          model: decodeURIComponent(encodedModel),
          stream: true,
        }
      : null;
  }

  if (pathname.endsWith(GEMINI_GENERATE_CONTENT_SUFFIX)) {
    const encodedModel = pathname.slice(
      GEMINI_MODELS_PREFIX.length,
      -GEMINI_GENERATE_CONTENT_SUFFIX.length
    );
    return encodedModel
      ? {
          model: decodeURIComponent(encodedModel),
          stream: false,
        }
      : null;
  }

  return null;
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

function resolveGeminiUsageMetadata(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      }
    | undefined
) {
  if (!usage) {
    return {
      promptTokenCount: null,
      candidatesTokenCount: null,
      totalTokenCount: null,
    };
  }

  return {
    promptTokenCount: usage.prompt_tokens ?? null,
    candidatesTokenCount: usage.completion_tokens ?? null,
    totalTokenCount: usage.total_tokens ?? null,
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

function encodeSseData(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function readSseDataBlock(block: string) {
  const lines = block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart());

  if (lines.length === 0) {
    return null;
  }

  return lines.join('\n');
}

function createGeminiStreamResponse(input: {
  body: ReadableStream<Uint8Array>;
  upstreamResponse: Response;
  traceId: string;
  fallbackModel: string;
  stopSequences: string[] | undefined;
}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffered = '';
  let emittedText = '';
  let finished = false;
  let finishReason: string | null = null;
  let usageMetadata: {
    promptTokenCount: number | null;
    candidatesTokenCount: number | null;
    totalTokenCount: number | null;
  } = {
    promptTokenCount: null,
    candidatesTokenCount: null,
    totalTokenCount: null,
  };

  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) => {
    controller.enqueue(encoder.encode(encodeSseData(payload)));
  };

  const emitText = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    if (!text) {
      return;
    }

    emit(controller, {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text }],
          },
          finishReason: null,
        },
      ],
    });
  };

  const emitFinal = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (finished) {
      return;
    }

    emit(controller, {
      candidates: [
        {
          finishReason: mapFinishReason(finishReason),
        },
      ],
      usageMetadata,
    });
    finished = true;
  };

  const processBlock = (controller: ReadableStreamDefaultController<Uint8Array>, block: string) => {
    if (finished) {
      return;
    }

    const data = readSseDataBlock(block);
    if (!data) {
      return;
    }

    if (data === '[DONE]') {
      emitFinal(controller);
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(data);
    } catch {
      return;
    }

    const payload = parsedJson as {
      id?: string;
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      choices?: Array<{
        delta?: {
          content?: string;
        };
        finish_reason?: string | null;
      }>;
    };
    const choice = payload.choices?.[0];
    const text = typeof choice?.delta?.content === 'string' ? choice.delta.content : null;

    if (payload.usage) {
      usageMetadata = resolveGeminiUsageMetadata(payload.usage);
    }

    if (text && text.length > 0) {
      const nextText = emittedText + text;
      const truncatedText = applyStopSequences(nextText, input.stopSequences);
      const textDelta = truncatedText.slice(emittedText.length);
      emittedText = truncatedText;
      emitText(controller, textDelta);

      if (truncatedText.length !== nextText.length) {
        finishReason = 'stop';
        emitFinal(controller);
        return;
      }
    }

    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
      emitFinal(controller);
    }
  };

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = input.body.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffered += decoder.decode(value, { stream: true });

            while (true) {
              const separatorIndex = buffered.indexOf('\n\n');
              if (separatorIndex === -1) {
                break;
              }

              const block = buffered.slice(0, separatorIndex);
              buffered = buffered.slice(separatorIndex + 2);
              processBlock(controller, block);
            }
          }

          buffered += decoder.decode();
          if (buffered.trim()) {
            processBlock(controller, buffered);
          }

          emitFinal(controller);
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
      async cancel() {
        await input.body.cancel();
      },
    }),
    {
      status: input.upstreamResponse.status,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': input.upstreamResponse.headers.get('cache-control') ?? 'no-cache',
        connection: input.upstreamResponse.headers.get('connection') ?? 'keep-alive',
        'x-trace-id': input.traceId,
        'x-gemini-model': input.fallbackModel,
      },
    }
  );
}

geminiContentsRouter.post('/models/*', async (c) => {
  const traceId = getTraceId(c.req.raw);
  const rawBody = await c.req.text();
  const pathname = new URL(c.req.url).pathname;
  const target = extractGeminiTarget(pathname);

  if (!target) {
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

  if (bodyModel && bodyModel !== target.model) {
    return createGatewayErrorResponse(
      'invalid_request',
      'Path model does not match request model',
      traceId,
      400
    );
  }

  const parsed = geminiContentsRequestSchema.safeParse({
    ...parsedJson,
    model: target.model,
  });
  if (!parsed.success) {
    return createGatewayErrorResponse(
      'invalid_request',
      'Invalid gemini contents request',
      traceId,
      400
    );
  }

  const requestedStream = target.stream || parsed.data.stream === true;
  const upstreamBody = JSON.stringify({
    model: parsed.data.model,
    messages: toOpenAiMessages(parsed.data.systemInstruction, parsed.data.contents),
    temperature: parsed.data.generationConfig?.temperature,
    top_p: parsed.data.generationConfig?.topP,
    max_tokens: parsed.data.generationConfig?.maxOutputTokens,
    stop: parsed.data.generationConfig?.stopSequences,
    stream: requestedStream,
  });

  return proxyGatewayRequest({
    c,
    endpoint: GEMINI_CONTENTS_ENDPOINT,
    model: parsed.data.model,
    rawBody: upstreamBody,
    allowStream: requestedStream,
    onStream: ({ body, upstreamResponse, traceId: upstreamTraceId }) =>
      createGeminiStreamResponse({
        body,
        upstreamResponse,
        traceId: upstreamTraceId,
        fallbackModel: parsed.data.model,
        stopSequences: parsed.data.generationConfig?.stopSequences,
      }),
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
          usageMetadata: resolveGeminiUsageMetadata(parsedResponse.data.usage),
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
