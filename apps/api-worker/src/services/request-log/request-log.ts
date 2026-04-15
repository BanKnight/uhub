import type { GatewayEndpoint, GatewayRequestStatus } from '@uhub/shared';
import type { WorkerEnv } from '../../index';
import { createRequestRecord, finishRequestRecord } from '../../repositories/requests-repo';

export type RequestLogStartInput = {
  apiKeyId: string;
  endpoint: GatewayEndpoint;
  model: string | null;
  channelId: string | null;
  traceId: string;
  rawBody: string;
};

export type RequestLogFinishInput = {
  id: string;
  startedAt: number;
  status: GatewayRequestStatus;
  httpStatus: number;
  responseBody: string | null;
};

export function getTraceId(request: Request) {
  return request.headers.get('x-trace-id') ?? crypto.randomUUID();
}

export function getBodySize(value: string | null) {
  return value ? new TextEncoder().encode(value).byteLength : null;
}

export function startRequestLog(env: WorkerEnv, input: RequestLogStartInput) {
  return createRequestRecord(env, {
    apiKeyId: input.apiKeyId,
    endpoint: input.endpoint,
    model: input.model,
    channelId: input.channelId,
    traceId: input.traceId,
    requestSize: getBodySize(input.rawBody),
  });
}

export function finishRequestLog(env: WorkerEnv, input: RequestLogFinishInput) {
  return finishRequestRecord(env, {
    id: input.id,
    status: input.status,
    httpStatus: input.httpStatus,
    latencyMs: Date.now() - input.startedAt,
    responseSize: getBodySize(input.responseBody),
  });
}
