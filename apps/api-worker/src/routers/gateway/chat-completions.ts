import { chatCompletionsRequestSchema } from "@uhub/shared";
import { Hono } from "hono";
import type { WorkerEnv } from "../../index";
import { getTraceId } from "../../services/request-log/request-log";
import { createGatewayErrorResponse } from "./error-response";
import { proxyGatewayRequest } from "./proxy-request";

const CHAT_COMPLETIONS_ENDPOINT = "openai_chat_completions";

export const chatCompletionsRouter = new Hono<{ Bindings: WorkerEnv }>();

chatCompletionsRouter.post("/chat/completions", async (c) => {
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

  const parsed = chatCompletionsRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return createGatewayErrorResponse(
      "invalid_request",
      "Invalid chat completions request",
      traceId,
      400,
    );
  }

  return proxyGatewayRequest({
    c,
    endpoint: CHAT_COMPLETIONS_ENDPOINT,
    model: parsed.data.model,
    rawBody,
    allowStream: parsed.data.stream === true,
  });
});
