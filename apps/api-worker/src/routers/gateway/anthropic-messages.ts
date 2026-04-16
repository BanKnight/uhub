import {
  type AnthropicMessage,
  type AnthropicUsage,
  type ChatMessage,
  anthropicMessagesRequestSchema,
  chatCompletionsResponseSchema,
} from "@uhub/shared";
import { Hono } from "hono";
import type { WorkerEnv } from "../../index";
import { getTraceId } from "../../services/request-log/request-log";
import { createGatewayErrorResponse } from "./error-response";
import { proxyGatewayRequest } from "./proxy-request";

const ANTHROPIC_MESSAGES_ENDPOINT = "anthropic_messages";

export const anthropicMessagesRouter = new Hono<{ Bindings: WorkerEnv }>();

function normalizeAnthropicContent(content: AnthropicMessage["content"]) {
  if (typeof content === "string") {
    return content;
  }

  return content.map((block) => block.text).join("\n");
}

function toOpenAiMessages(
  system: string | undefined,
  messages: AnthropicMessage[],
): ChatMessage[] {
  const normalizedMessages = messages.map((message) => ({
    role: message.role,
    content: normalizeAnthropicContent(message.content),
  })) satisfies ChatMessage[];

  if (!system) {
    return normalizedMessages;
  }

  return [{ role: "system", content: system }, ...normalizedMessages];
}

function mapFinishReasonToStopReason(finishReason: string | null | undefined) {
  if (finishReason === "stop") {
    return "end_turn";
  }

  if (finishReason === "length") {
    return "max_tokens";
  }

  return finishReason ?? "end_turn";
}

function applyStopSequences(text: string, stopSequences: string[] | undefined) {
  if (!stopSequences || stopSequences.length === 0) {
    return {
      text,
      stopSequence: null,
    };
  }

  for (const stopSequence of stopSequences) {
    const index = text.indexOf(stopSequence);
    if (index !== -1) {
      return {
        text: text.slice(0, index),
        stopSequence,
      };
    }
  }

  return {
    text,
    stopSequence: null,
  };
}

function estimateAnthropicUsage(input: {
  requestBody: string;
  responseText: string;
}): AnthropicUsage {
  const encoder = new TextEncoder();

  return {
    input_tokens: Math.max(
      1,
      Math.ceil(encoder.encode(input.requestBody).byteLength / 4),
    ),
    output_tokens: Math.max(
      1,
      Math.ceil(encoder.encode(input.responseText).byteLength / 4),
    ),
  };
}

function encodeAnthropicEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function readSseDataBlock(block: string) {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  if (lines.length === 0) {
    return null;
  }

  return lines.join("\n");
}

function createAnthropicStreamResponse(input: {
  body: ReadableStream<Uint8Array>;
  upstreamResponse: Response;
  traceId: string;
  fallbackModel: string;
  requestBody: string;
  stopSequences: string[] | undefined;
}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffered = "";
  let messageStarted = false;
  let contentBlockStarted = false;
  let messageStopped = false;
  let responseModel = input.fallbackModel;
  let responseId = crypto.randomUUID();
  let stopReason: string | null = null;
  let matchedStopSequence: string | null = null;
  let emittedText = "";
  const usage = estimateAnthropicUsage({
    requestBody: input.requestBody,
    responseText: "",
  });

  const emit = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown,
  ) => {
    controller.enqueue(encoder.encode(encodeAnthropicEvent(event, data)));
  };

  const startMessage = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    if (messageStarted) {
      return;
    }

    emit(controller, "message_start", {
      type: "message_start",
      message: {
        id: responseId,
        type: "message",
        role: "assistant",
        content: [],
        model: responseModel,
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    });
    messageStarted = true;
  };

  const startContentBlock = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    startMessage(controller);
    if (contentBlockStarted) {
      return;
    }

    emit(controller, "content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "text",
        text: "",
      },
    });
    contentBlockStarted = true;
  };

  const stopMessage = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    if (messageStopped || !messageStarted) {
      return;
    }

    if (contentBlockStarted) {
      emit(controller, "content_block_stop", {
        type: "content_block_stop",
        index: 0,
      });
    }

    emit(controller, "message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: stopReason ?? "end_turn",
        stop_sequence: matchedStopSequence,
      },
      usage,
    });
    emit(controller, "message_stop", {
      type: "message_stop",
    });
    messageStopped = true;
  };

  const processBlock = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    block: string,
  ) => {
    if (messageStopped) {
      return;
    }

    const data = readSseDataBlock(block);
    if (!data) {
      return;
    }

    if (data === "[DONE]") {
      stopMessage(controller);
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
      choices?: Array<{
        delta?: { content?: string; role?: string };
        finish_reason?: string | null;
      }>;
    };
    const choice = payload.choices?.[0];

    if (payload.id) {
      responseId = payload.id;
    }
    if (payload.model) {
      responseModel = payload.model;
    }

    startMessage(controller);

    const text =
      typeof choice?.delta?.content === "string" ? choice.delta.content : null;
    if (text && text.length > 0) {
      const nextText = emittedText + text;
      const stopMatch = applyStopSequences(nextText, input.stopSequences);
      const textDelta = stopMatch.text.slice(emittedText.length);

      emittedText = stopMatch.text;
      usage.output_tokens = Math.max(
        1,
        Math.ceil(new TextEncoder().encode(emittedText).byteLength / 4),
      );

      if (textDelta.length > 0) {
        startContentBlock(controller);
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: textDelta,
          },
        });
      }

      if (stopMatch.stopSequence) {
        matchedStopSequence = stopMatch.stopSequence;
        stopReason = "stop_sequence";
        stopMessage(controller);
        return;
      }
    }

    if (choice?.finish_reason) {
      stopReason = mapFinishReasonToStopReason(choice.finish_reason);
      stopMessage(controller);
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
              const separatorIndex = buffered.indexOf("\n\n");
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

          stopMessage(controller);
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
        "content-type": "text/event-stream",
        "cache-control":
          input.upstreamResponse.headers.get("cache-control") ?? "no-cache",
        connection:
          input.upstreamResponse.headers.get("connection") ?? "keep-alive",
        "x-trace-id": input.traceId,
      },
    },
  );
}

anthropicMessagesRouter.post("/v1/messages", async (c) => {
  const traceId = getTraceId(c.req.raw);
  const rawBody = await c.req.text();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return createGatewayErrorResponse(
      "invalid_request",
      "Request body must be valid JSON",
      traceId,
      400,
    );
  }

  const parsed = anthropicMessagesRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return createGatewayErrorResponse(
      "invalid_request",
      "Invalid anthropic messages request",
      traceId,
      400,
    );
  }

  const upstreamBody = JSON.stringify({
    model: parsed.data.model,
    messages: toOpenAiMessages(parsed.data.system, parsed.data.messages),
    max_tokens: parsed.data.max_tokens,
    temperature: parsed.data.temperature,
    top_p: parsed.data.top_p,
    stop: parsed.data.stop_sequences,
    stream: parsed.data.stream === true,
  });

  return proxyGatewayRequest({
    c,
    endpoint: ANTHROPIC_MESSAGES_ENDPOINT,
    model: parsed.data.model,
    rawBody: upstreamBody,
    allowStream: parsed.data.stream === true,
    onStream: ({ body, upstreamResponse, traceId: upstreamTraceId }) =>
      createAnthropicStreamResponse({
        body,
        upstreamResponse,
        traceId: upstreamTraceId,
        fallbackModel: parsed.data.model,
        requestBody: rawBody,
        stopSequences: parsed.data.stop_sequences,
      }),
    onSuccess: ({ responseBody, traceId: upstreamTraceId }) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(responseBody);
      } catch {
        return createGatewayErrorResponse(
          "network_error",
          "Gateway response translation failed",
          upstreamTraceId,
          502,
        );
      }

      const parsedResponse =
        chatCompletionsResponseSchema.safeParse(parsedJson);
      if (!parsedResponse.success) {
        return createGatewayErrorResponse(
          "network_error",
          "Gateway response translation failed",
          upstreamTraceId,
          502,
        );
      }

      const text = parsedResponse.data.choices
        .map((choice) => choice.message.content)
        .filter((value) => value.length > 0)
        .join("\n");
      const stopMatch = applyStopSequences(text, parsed.data.stop_sequences);
      const usage = estimateAnthropicUsage({
        requestBody: rawBody,
        responseText: stopMatch.text,
      });

      return new Response(
        JSON.stringify({
          id: parsedResponse.data.id,
          type: "message",
          role: "assistant",
          model: parsedResponse.data.model,
          content: [{ type: "text", text: stopMatch.text }],
          stop_reason: stopMatch.stopSequence
            ? "stop_sequence"
            : (mapFinishReasonToStopReason(
                parsedResponse.data.choices[0]?.finishReason,
              ) ?? "end_turn"),
          stop_sequence: stopMatch.stopSequence,
          usage,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-trace-id": upstreamTraceId,
          },
        },
      );
    },
  });
});
