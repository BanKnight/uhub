import type { GatewayEndpoint } from "@uhub/shared";
import type { WorkerEnv } from "../../index";
import {
  acquireConcurrencyLease,
  releaseConcurrencyLease,
} from "../../lib/concurrency";
import { requireApiKey } from "../../middleware/require-api-key";
import { requireActiveGatewayChannel } from "../../services/gateway/channels";
import {
  finishRequestLog,
  getTraceId,
  startRequestLog,
} from "../../services/request-log/request-log";
import {
  createGatewayAbortSignal,
  createGatewayErrorResponse,
  isAbortError,
  readGatewayErrorMessage,
} from "./error-response";

type ProxyGatewayRequestInput = {
  c: { env: WorkerEnv; req: { raw: Request }; executionCtx: ExecutionContext };
  endpoint: GatewayEndpoint;
  model: string;
  rawBody: string;
  allowStream: boolean;
  onSuccess?: (input: {
    responseBody: string;
    upstreamResponse: Response;
    traceId: string;
  }) => Response | Promise<Response>;
};

export async function proxyGatewayRequest(input: ProxyGatewayRequestInput) {
  const traceId = getTraceId(input.c.req.raw);
  let requestLog: { id: string; startedAt: number } | null = null;
  let concurrencyLease: { leaseId: string; expiresAt: number } | null = null;
  let leaseApiKeyId: string | null = null;
  let releaseHandledByStream = false;

  try {
    const auth = await requireApiKey(
      input.c.env,
      input.c.req.raw,
      input.endpoint,
    );
    const channel = await requireActiveGatewayChannel(
      input.c.env,
      auth.channelId,
    );
    concurrencyLease = await acquireConcurrencyLease(
      input.c.env,
      auth.apiKey.id,
      auth.apiKey.maxConcurrency,
    );
    leaseApiKeyId = auth.apiKey.id;

    if (!concurrencyLease) {
      return createGatewayErrorResponse(
        "auth_error",
        "API key concurrency limit exceeded",
        traceId,
        429,
      );
    }

    requestLog = await startRequestLog(input.c.env, {
      apiKeyId: auth.apiKey.id,
      endpoint: input.endpoint,
      model: input.model,
      channelId: channel.id,
      traceId,
      rawBody: input.rawBody,
    });

    const upstreamResponse = await fetch(
      `${channel.baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-id": traceId,
        },
        body: input.rawBody,
        signal: createGatewayAbortSignal(),
      },
    );

    const contentType =
      upstreamResponse.headers.get("content-type") ?? "application/json";

    if (!upstreamResponse.ok) {
      const responseBody = await upstreamResponse.text();

      await finishRequestLog(input.c.env, {
        id: requestLog.id,
        startedAt: requestLog.startedAt,
        status: "failed",
        failureClass: "upstream_error",
        httpStatus: upstreamResponse.status,
        responseBody,
      });

      const message = readGatewayErrorMessage(
        responseBody,
        "Upstream request failed",
      );
      return createGatewayErrorResponse(
        "upstream_error",
        message,
        traceId,
        upstreamResponse.status,
        upstreamResponse.status,
      );
    }

    const isStream =
      input.allowStream && contentType.includes("text/event-stream");

    if (isStream && upstreamResponse.body) {
      let streamedBytes = 0;
      const requestLogSnapshot = requestLog;
      const leaseSnapshot = concurrencyLease;
      const leaseApiKeyIdSnapshot = leaseApiKeyId;
      const [clientBody, logBody] = upstreamResponse.body.tee();
      releaseHandledByStream = true;

      input.c.executionCtx.waitUntil(
        (async () => {
          const reader = logBody.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              streamedBytes += value?.byteLength ?? 0;
            }

            await finishRequestLog(input.c.env, {
              id: requestLogSnapshot.id,
              startedAt: requestLogSnapshot.startedAt,
              status: "completed",
              failureClass: null,
              httpStatus: upstreamResponse.status,
              responseBody: null,
              responseSize: streamedBytes,
            });
          } catch (error) {
            await finishRequestLog(input.c.env, {
              id: requestLogSnapshot.id,
              startedAt: requestLogSnapshot.startedAt,
              status: "failed",
              failureClass: isAbortError(error)
                ? "upstream_timeout"
                : "network_error",
              httpStatus: upstreamResponse.status,
              responseBody: null,
              responseSize: streamedBytes,
            });
          } finally {
            if (leaseSnapshot && leaseApiKeyIdSnapshot) {
              await releaseConcurrencyLease(
                input.c.env,
                leaseApiKeyIdSnapshot,
                leaseSnapshot.leaseId,
              );
            }
          }
        })(),
      );

      return new Response(clientBody, {
        status: upstreamResponse.status,
        headers: {
          "content-type": contentType,
          "cache-control":
            upstreamResponse.headers.get("cache-control") ?? "no-cache",
          connection:
            upstreamResponse.headers.get("connection") ?? "keep-alive",
          "x-trace-id": traceId,
        },
      });
    }

    const responseBody = await upstreamResponse.text();

    await finishRequestLog(input.c.env, {
      id: requestLog.id,
      startedAt: requestLog.startedAt,
      status: "completed",
      failureClass: null,
      httpStatus: upstreamResponse.status,
      responseBody,
    });

    if (input.onSuccess) {
      return input.onSuccess({ responseBody, upstreamResponse, traceId });
    }

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        "content-type": contentType,
        "x-trace-id": traceId,
      },
    });
  } catch (error) {
    if (requestLog) {
      await finishRequestLog(input.c.env, {
        id: requestLog.id,
        startedAt: requestLog.startedAt,
        status: "failed",
        failureClass: isAbortError(error)
          ? "upstream_timeout"
          : "network_error",
        httpStatus: null,
        responseBody: null,
      });
    }

    if (error instanceof Response) {
      return createGatewayErrorResponse(
        "auth_error",
        "Gateway authorization failed",
        traceId,
        error.status,
        error.status,
      );
    }

    if (isAbortError(error)) {
      return createGatewayErrorResponse(
        "upstream_timeout",
        "Upstream request timed out",
        traceId,
        504,
      );
    }

    return createGatewayErrorResponse(
      "network_error",
      "Gateway request failed",
      traceId,
      502,
    );
  } finally {
    if (!releaseHandledByStream && concurrencyLease && leaseApiKeyId) {
      await releaseConcurrencyLease(
        input.c.env,
        leaseApiKeyId,
        concurrencyLease.leaseId,
      );
    }
  }
}
