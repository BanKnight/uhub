import {
  type AnthropicMessage,
  type AnthropicUsage,
  type ChatCompletionsResponse,
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

function normalizeAnthropicInputBlocks(
  blocks: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { media_type: string } }
    | {
        type: "document";
        source:
          | { type: "base64"; media_type: string }
          | { type: "text"; text: string };
      }
  >,
) {
  return blocks
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }

      if (block.type === "image") {
        return `[image:${block.source.media_type}]`;
      }

      if (block.source.type === "text") {
        return `[document:text] ${block.source.text}`;
      }

      return `[document:${block.source.media_type}]`;
    })
    .join("\n");
}

function normalizeAnthropicContent(content: AnthropicMessage["content"]) {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }

      if (block.type === "image") {
        return `[image:${block.source.media_type}]`;
      }

      if (block.type === "document") {
        return block.source.type === "text"
          ? `[document:text] ${block.source.text}`
          : `[document:${block.source.media_type}]`;
      }

      if (block.type === "tool_use") {
        return `[tool_use:${block.id}:${block.name}] ${JSON.stringify(block.input)}`;
      }

      const toolResultContent =
        typeof block.content === "string"
          ? block.content
          : normalizeAnthropicInputBlocks(block.content);
      return `[tool_result:${block.tool_use_id}] ${toolResultContent}`;
    })
    .join("\n");
}

function normalizeAnthropicSystem(
  system: string | Array<{ type: "text"; text: string }> | undefined,
) {
  if (!system) {
    return undefined;
  }

  if (typeof system === "string") {
    return system;
  }

  return normalizeAnthropicInputBlocks(system);
}

function toOpenAiMessages(
  system: string | Array<{ type: "text"; text: string }> | undefined,
  messages: AnthropicMessage[],
): ChatMessage[] {
  const normalizedMessages = messages.map((message) => ({
    role: message.role,
    content: normalizeAnthropicContent(message.content),
  })) satisfies ChatMessage[];

  const normalizedSystem = normalizeAnthropicSystem(system);

  if (!normalizedSystem) {
    return normalizedMessages;
  }

  return [{ role: "system", content: normalizedSystem }, ...normalizedMessages];
}

function mapFinishReasonToStopReason(finishReason: string | null | undefined) {
  if (finishReason === "stop") {
    return "end_turn";
  }

  if (finishReason === "length") {
    return "max_tokens";
  }

  if (finishReason === "tool_calls") {
    return "tool_use";
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

function parseToolUseInput(argumentsText: string) {
  if (!argumentsText.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return { value: parsed };
  } catch {
    return { raw: argumentsText };
  }
}

function toAnthropicResponseContent(
  message: ChatCompletionsResponse["choices"][number]["message"],
  stopSequences: string[] | undefined,
) {
  const text = typeof message.content === "string" ? message.content : "";
  const stopMatch = applyStopSequences(text, stopSequences);
  const toolCalls = message.toolCalls ?? message.tool_calls ?? [];
  const content = [] as Array<
    | { type: "text"; text: string }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
  >;

  if (stopMatch.text.length > 0) {
    content.push({
      type: "text",
      text: stopMatch.text,
    });
  }

  for (const toolCall of toolCalls) {
    content.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseToolUseInput(toolCall.function.arguments),
    });
  }

  return {
    content,
    stopSequence: stopMatch.stopSequence,
    responseText: JSON.stringify(content),
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
  let activeContentBlock:
    | { index: number; type: "text" }
    | {
        index: number;
        type: "tool_use";
        toolCallIndex: number;
        id: string;
        name: string;
        inputBuffer: string;
      }
    | null = null;
  let nextContentBlockIndex = 0;
  let messageStopped = false;
  let responseModel = input.fallbackModel;
  let responseId: string = crypto.randomUUID();
  let stopReason: string | null = null;
  let matchedStopSequence: string | null = null;
  let emittedText = "";
  const streamToolUses = new Map<
    number,
    {
      contentIndex: number;
      id: string;
      name: string;
      inputBuffer: string;
      started: boolean;
    }
  >();
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

  const startTextBlock = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    startMessage(controller);
    if (activeContentBlock?.type === "text") {
      return activeContentBlock.index;
    }
    closeActiveContentBlock(controller);

    const index = nextContentBlockIndex++;
    emit(controller, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: {
        type: "text",
        text: "",
      },
    });
    activeContentBlock = { index, type: "text" };
    return index;
  };

  const closeActiveContentBlock = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    if (!activeContentBlock) {
      return;
    }

    emit(controller, "content_block_stop", {
      type: "content_block_stop",
      index: activeContentBlock.index,
    });
    activeContentBlock = null;
  };

  const upsertToolUseBlock = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    toolCall: {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    },
  ) => {
    startMessage(controller);

    const toolCallIndex = toolCall.index ?? 0;
    const existing = streamToolUses.get(toolCallIndex);
    const id = toolCall.id ?? existing?.id;
    const nextNameChunk = toolCall.function?.name ?? "";
    const nextInputChunk = toolCall.function?.arguments ?? "";

    if (!id) {
      return;
    }

    const toolUse = existing ?? {
      contentIndex: nextContentBlockIndex++,
      id,
      name: "",
      inputBuffer: "",
      started: false,
    };

    toolUse.id = id;
    if (nextNameChunk.length > 0) {
      toolUse.name += nextNameChunk;
    }
    if (nextInputChunk.length > 0) {
      toolUse.inputBuffer += nextInputChunk;
    }

    streamToolUses.set(toolCallIndex, toolUse);

    usage.output_tokens = Math.max(
      1,
      Math.ceil(
        new TextEncoder().encode(
          JSON.stringify({
            id: toolUse.id,
            name: toolUse.name,
            input: parseToolUseInput(toolUse.inputBuffer),
          }),
        ).byteLength / 4,
      ),
    );
  };

  const stopMessage = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    if (messageStopped || !messageStarted) {
      return;
    }

    closeActiveContentBlock(controller);

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
        delta?: {
          content?: string;
          role?: string;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            type?: "function";
            function?: { name?: string; arguments?: string };
          }>;
        };
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
        const index = startTextBlock(controller);
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index,
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

    const toolCalls = choice?.delta?.tool_calls ?? [];
    for (const toolCall of toolCalls) {
      upsertToolUseBlock(controller, toolCall);
    }

    if (choice?.finish_reason) {
      for (const [toolCallIndex, toolUse] of streamToolUses) {
        if (!toolUse.id || !toolUse.name) {
          continue;
        }

        if (
          activeContentBlock &&
          !(
            activeContentBlock.type === "tool_use" &&
            activeContentBlock.toolCallIndex === toolCallIndex
          )
        ) {
          closeActiveContentBlock(controller);
        }

        if (!toolUse.started) {
          emit(controller, "content_block_start", {
            type: "content_block_start",
            index: toolUse.contentIndex,
            content_block: {
              type: "tool_use",
              id: toolUse.id,
              name: toolUse.name,
              input: {},
            },
          });
          toolUse.started = true;
        }

        activeContentBlock = {
          index: toolUse.contentIndex,
          type: "tool_use",
          toolCallIndex,
          id: toolUse.id,
          name: toolUse.name,
          inputBuffer: toolUse.inputBuffer,
        };

        if (toolUse.inputBuffer.length > 0) {
          emit(controller, "content_block_delta", {
            type: "content_block_delta",
            index: toolUse.contentIndex,
            delta: {
              type: "input_json_delta",
              partial_json: toolUse.inputBuffer,
            },
          });
        }
      }

      stopReason =
        streamToolUses.size > 0 && choice.finish_reason === "stop"
          ? "tool_use"
          : mapFinishReasonToStopReason(choice.finish_reason);
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

      const firstChoice = parsedResponse.data.choices[0];
      const translatedContent = toAnthropicResponseContent(
        firstChoice?.message ?? { role: "assistant", content: "" },
        parsed.data.stop_sequences,
      );
      const usage = estimateAnthropicUsage({
        requestBody: rawBody,
        responseText: translatedContent.responseText,
      });
      const finishReason =
        firstChoice?.finishReason ?? firstChoice?.finish_reason ?? null;
      const hasToolUse = translatedContent.content.some(
        (block) => block.type === "tool_use",
      );

      return new Response(
        JSON.stringify({
          id: parsedResponse.data.id,
          type: "message",
          role: "assistant",
          model: parsedResponse.data.model,
          content: translatedContent.content,
          stop_reason: translatedContent.stopSequence
            ? "stop_sequence"
            : hasToolUse
              ? "tool_use"
              : (mapFinishReasonToStopReason(finishReason) ?? "end_turn"),
          stop_sequence: translatedContent.stopSequence,
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
