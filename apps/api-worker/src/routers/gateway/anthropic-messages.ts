import {
  type AnthropicMessage,
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

  if (parsed.data.stream) {
    return createGatewayErrorResponse(
      "invalid_request",
      "Claude streaming is not supported yet",
      traceId,
      400,
    );
  }

  const upstreamBody = JSON.stringify({
    model: parsed.data.model,
    messages: toOpenAiMessages(parsed.data.system, parsed.data.messages),
    temperature: parsed.data.temperature,
    stream: false,
  });

  return proxyGatewayRequest({
    c,
    endpoint: ANTHROPIC_MESSAGES_ENDPOINT,
    model: parsed.data.model,
    rawBody: upstreamBody,
    allowStream: false,
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

      return new Response(
        JSON.stringify({
          id: parsedResponse.data.id,
          type: "message",
          role: "assistant",
          model: parsedResponse.data.model,
          content: [{ type: "text", text }],
          stop_reason:
            parsedResponse.data.choices[0]?.finishReason ?? "end_turn",
          stop_sequence: null,
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
