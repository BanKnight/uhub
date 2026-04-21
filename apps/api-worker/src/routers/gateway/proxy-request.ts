import type { GatewayEndpoint, GatewayFailureClass } from '@uhub/shared';
import type { WorkerEnv } from '../../index';
import { acquireConcurrencyLease, releaseConcurrencyLease } from '../../lib/concurrency';
import { requireApiKey } from '../../middleware/require-api-key';
import {
  type GatewayChannel,
  listActiveGatewayChannels,
  markGatewayChannelHealthy,
  markGatewayChannelUnhealthyForEnv,
  prioritizeGatewayChannels,
} from '../../services/gateway/channels';
import {
  finishRequestLog,
  getTraceId,
  startRequestLog,
} from '../../services/request-log/request-log';
import { toRequestTokenUsage } from '../../repositories/requests-repo';
import {
  createGatewayAbortSignal,
  createGatewayErrorResponse,
  isAbortError,
  readGatewayErrorMessage,
} from './error-response';

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
  onStream?: (input: {
    body: ReadableStream<Uint8Array>;
    upstreamResponse: Response;
    traceId: string;
  }) => Response | Promise<Response>;
};

type AttemptFailure = {
  channel: GatewayChannel;
  failureClass: GatewayFailureClass;
  message: string;
  status: number;
  upstreamStatus: number | null;
  responseBody: string | null;
};

function isRetriableUpstreamStatus(status: number) {
  return status >= 500;
}

function shouldContinueToNextChannel(failure: AttemptFailure, hasMoreChannels: boolean) {
  if (!hasMoreChannels) {
    return false;
  }

  if (failure.failureClass === 'network_error') {
    return true;
  }

  if (failure.failureClass === 'upstream_timeout') {
    return true;
  }

  return (
    failure.failureClass === 'upstream_error' &&
    typeof failure.upstreamStatus === 'number' &&
    isRetriableUpstreamStatus(failure.upstreamStatus)
  );
}

function resolveGatewayTimeoutMs(rawValue: string | undefined) {
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveUsageNumber(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function extractUsageFromChatCompletionsResponse(responseBody: string) {
  try {
    const parsed = JSON.parse(responseBody) as {
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        total_tokens?: unknown;
      };
    };

    return toRequestTokenUsage({
      inputTokens: resolveUsageNumber(parsed?.usage?.prompt_tokens),
      outputTokens: resolveUsageNumber(parsed?.usage?.completion_tokens),
      totalTokens: resolveUsageNumber(parsed?.usage?.total_tokens),
    });
  } catch {
    return toRequestTokenUsage(null);
  }
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

function extractUsageFromChatCompletionsStreamPayload(data: string) {
  if (data === '[DONE]') {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as {
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        total_tokens?: unknown;
      };
    };

    return toRequestTokenUsage({
      inputTokens: resolveUsageNumber(parsed?.usage?.prompt_tokens),
      outputTokens: resolveUsageNumber(parsed?.usage?.completion_tokens),
      totalTokens: resolveUsageNumber(parsed?.usage?.total_tokens),
    });
  } catch {
    return null;
  }
}

export async function proxyGatewayRequest(input: ProxyGatewayRequestInput) {
  const traceId = getTraceId(input.c.req.raw);
  let requestLog: { id: string; startedAt: number } | null = null;
  let concurrencyLease: { leaseId: string; expiresAt: number } | null = null;
  let leaseApiKeyId: string | null = null;
  let releaseHandledByStream = false;

  try {
    const auth = await requireApiKey(input.c.env, input.c.req.raw, input.endpoint);
    const activeChannels = await listActiveGatewayChannels(input.c.env, auth.channelIds);

    if (activeChannels.length === 0) {
      return createGatewayErrorResponse(
        'auth_error',
        'Allowed channels are not active',
        traceId,
        403
      );
    }

    const prioritizedChannels = prioritizeGatewayChannels(
      activeChannels,
      input.c.req.raw.headers.get('x-trace-id')
    );

    concurrencyLease = await acquireConcurrencyLease(
      input.c.env,
      auth.apiKey.id,
      auth.apiKey.maxConcurrency
    );
    leaseApiKeyId = auth.apiKey.id;

    if (!concurrencyLease) {
      return createGatewayErrorResponse(
        'auth_error',
        'API key concurrency limit exceeded',
        traceId,
        429
      );
    }

    requestLog = await startRequestLog(input.c.env, {
      apiKeyId: auth.apiKey.id,
      endpoint: input.endpoint,
      model: input.model,
      channelId: prioritizedChannels[0]?.id ?? null,
      traceId,
      rawBody: input.rawBody,
    });

    let lastFailure: AttemptFailure | null = null;

    for (const [index, channel] of prioritizedChannels.entries()) {
      try {
        const upstreamResponse = await fetch(
          `${channel.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-trace-id': traceId,
            },
            body: input.rawBody,
            signal: createGatewayAbortSignal(
              resolveGatewayTimeoutMs(input.c.env.GATEWAY_TIMEOUT_MS)
            ),
          }
        );

        const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json';

        if (!upstreamResponse.ok) {
          const responseBody = await upstreamResponse.text();
          const message = readGatewayErrorMessage(responseBody, 'Upstream request failed');
          const failure: AttemptFailure = {
            channel,
            failureClass: 'upstream_error',
            message,
            status: upstreamResponse.status,
            upstreamStatus: upstreamResponse.status,
            responseBody,
          };

          if (isRetriableUpstreamStatus(upstreamResponse.status)) {
            markGatewayChannelUnhealthyForEnv(input.c.env, channel.id);
          }

          lastFailure = failure;
          if (shouldContinueToNextChannel(failure, index < prioritizedChannels.length - 1)) {
            continue;
          }

          await finishRequestLog(input.c.env, {
            id: requestLog.id,
            startedAt: requestLog.startedAt,
            status: 'failed',
            failureClass: failure.failureClass,
            channelId: channel.id,
            httpStatus: failure.status,
            responseBody: failure.responseBody,
          });

          return createGatewayErrorResponse(
            failure.failureClass,
            failure.message,
            traceId,
            failure.status,
            failure.upstreamStatus
          );
        }

        markGatewayChannelHealthy(channel.id);

        const isStream = input.allowStream && contentType.includes('text/event-stream');

        if (isStream && upstreamResponse.body) {
          let streamedBytes = 0;
          let buffered = '';
          let streamUsage = toRequestTokenUsage(null);
          const decoder = new TextDecoder();
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
                  buffered += decoder.decode(value, { stream: true });

                  while (true) {
                    const separatorIndex = buffered.indexOf('\n\n');
                    if (separatorIndex === -1) {
                      break;
                    }

                    const block = buffered.slice(0, separatorIndex);
                    buffered = buffered.slice(separatorIndex + 2);
                    const data = readSseDataBlock(block);
                    const usage = data ? extractUsageFromChatCompletionsStreamPayload(data) : null;
                    if (usage) {
                      streamUsage = usage;
                    }
                  }
                }

                buffered += decoder.decode();
                if (buffered.trim()) {
                  const data = readSseDataBlock(buffered);
                  const usage = data ? extractUsageFromChatCompletionsStreamPayload(data) : null;
                  if (usage) {
                    streamUsage = usage;
                  }
                }

                await finishRequestLog(input.c.env, {
                  id: requestLogSnapshot.id,
                  startedAt: requestLogSnapshot.startedAt,
                  status: 'completed',
                  failureClass: null,
                  channelId: channel.id,
                  httpStatus: upstreamResponse.status,
                  responseBody: null,
                  responseSize: streamedBytes,
                  usage: streamUsage,
                });
              } catch (error) {
                markGatewayChannelUnhealthyForEnv(input.c.env, channel.id);
                await finishRequestLog(input.c.env, {
                  id: requestLogSnapshot.id,
                  startedAt: requestLogSnapshot.startedAt,
                  status: 'failed',
                  failureClass: isAbortError(error) ? 'upstream_timeout' : 'network_error',
                  channelId: channel.id,
                  httpStatus: upstreamResponse.status,
                  responseBody: null,
                  responseSize: streamedBytes,
                });
              } finally {
                if (leaseSnapshot && leaseApiKeyIdSnapshot) {
                  await releaseConcurrencyLease(
                    input.c.env,
                    leaseApiKeyIdSnapshot,
                    leaseSnapshot.leaseId
                  );
                }
              }
            })()
          );

          if (input.onStream) {
            return input.onStream({
              body: clientBody,
              upstreamResponse,
              traceId,
            });
          }

          return new Response(clientBody, {
            status: upstreamResponse.status,
            headers: {
              'content-type': contentType,
              'cache-control': upstreamResponse.headers.get('cache-control') ?? 'no-cache',
              connection: upstreamResponse.headers.get('connection') ?? 'keep-alive',
              'x-trace-id': traceId,
            },
          });
        }

        const responseBody = await upstreamResponse.text();

        await finishRequestLog(input.c.env, {
          id: requestLog.id,
          startedAt: requestLog.startedAt,
          status: 'completed',
          failureClass: null,
          channelId: channel.id,
          httpStatus: upstreamResponse.status,
          responseBody,
          usage: extractUsageFromChatCompletionsResponse(responseBody),
        });

        if (input.onSuccess) {
          return input.onSuccess({ responseBody, upstreamResponse, traceId });
        }

        return new Response(responseBody, {
          status: upstreamResponse.status,
          headers: {
            'content-type': contentType,
            'x-trace-id': traceId,
          },
        });
      } catch (error) {
        const failure: AttemptFailure = {
          channel,
          failureClass: isAbortError(error) ? 'upstream_timeout' : 'network_error',
          message: isAbortError(error) ? 'Upstream request timed out' : 'Gateway request failed',
          status: isAbortError(error) ? 504 : 502,
          upstreamStatus: null,
          responseBody: null,
        };

        markGatewayChannelUnhealthyForEnv(input.c.env, channel.id);
        lastFailure = failure;

        if (shouldContinueToNextChannel(failure, index < prioritizedChannels.length - 1)) {
          continue;
        }

        await finishRequestLog(input.c.env, {
          id: requestLog.id,
          startedAt: requestLog.startedAt,
          status: 'failed',
          failureClass: failure.failureClass,
          channelId: channel.id,
          httpStatus: null,
          responseBody: null,
        });

        return createGatewayErrorResponse(
          failure.failureClass,
          failure.message,
          traceId,
          failure.status,
          failure.upstreamStatus
        );
      }
    }

    if (lastFailure && requestLog) {
      await finishRequestLog(input.c.env, {
        id: requestLog.id,
        startedAt: requestLog.startedAt,
        status: 'failed',
        failureClass: lastFailure.failureClass,
        channelId: lastFailure.channel.id,
        httpStatus: lastFailure.upstreamStatus,
        responseBody: lastFailure.responseBody,
      });

      return createGatewayErrorResponse(
        lastFailure.failureClass,
        lastFailure.message,
        traceId,
        lastFailure.status,
        lastFailure.upstreamStatus
      );
    }

    return createGatewayErrorResponse(
      'auth_error',
      'Allowed channels are not active',
      traceId,
      403
    );
  } catch (error) {
    if (requestLog) {
      await finishRequestLog(input.c.env, {
        id: requestLog.id,
        startedAt: requestLog.startedAt,
        status: 'failed',
        failureClass: isAbortError(error) ? 'upstream_timeout' : 'network_error',
        httpStatus: null,
        responseBody: null,
      });
    }

    if (error instanceof Response) {
      return createGatewayErrorResponse(
        'auth_error',
        'Gateway authorization failed',
        traceId,
        error.status,
        error.status
      );
    }

    if (isAbortError(error)) {
      return createGatewayErrorResponse(
        'upstream_timeout',
        'Upstream request timed out',
        traceId,
        504
      );
    }

    return createGatewayErrorResponse('network_error', 'Gateway request failed', traceId, 502);
  } finally {
    if (!releaseHandledByStream && concurrencyLease && leaseApiKeyId) {
      await releaseConcurrencyLease(input.c.env, leaseApiKeyId, concurrencyLease.leaseId);
    }
  }
}
