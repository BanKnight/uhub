import type { GatewayError, GatewayFailureClass } from '@uhub/shared';

const GATEWAY_TIMEOUT_MS = 30_000;

export function createGatewayError(
  type: GatewayFailureClass,
  message: string,
  traceId: string,
  upstreamStatus: number | null = null
): GatewayError {
  return {
    error: {
      type,
      message,
      traceId,
      upstreamStatus,
    },
  };
}

export function createGatewayErrorResponse(
  type: GatewayFailureClass,
  message: string,
  traceId: string,
  status: number,
  upstreamStatus: number | null = null
) {
  return new Response(JSON.stringify(createGatewayError(type, message, traceId, upstreamStatus)), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-trace-id': traceId,
    },
  });
}

export function readGatewayErrorMessage(text: string, fallback: string) {
  if (!text) {
    return fallback;
  }

  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof json.error === 'string' && json.error.trim()) {
      return json.error;
    }
    if (
      json.error &&
      typeof json.error === 'object' &&
      typeof json.error.message === 'string' &&
      json.error.message.trim()
    ) {
      return json.error.message;
    }
  } catch {
    // ignore json parse failure, fall back to raw text
  }

  return text;
}

export function createGatewayAbortSignal(timeoutMs = GATEWAY_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

export function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
