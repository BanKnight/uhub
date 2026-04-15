import { chatCompletionsRequestSchema } from '@uhub/shared';
import { Hono } from 'hono';
import type { WorkerEnv } from '../../index';
import { acquireConcurrencyLease, releaseConcurrencyLease } from '../../lib/concurrency';
import { requireApiKey } from '../../middleware/require-api-key';
import { requireActiveGatewayChannel } from '../../services/gateway/channels';
import { finishRequestLog, getTraceId, startRequestLog } from '../../services/request-log/request-log';

const CHAT_COMPLETIONS_ENDPOINT = 'openai_chat_completions';

export const chatCompletionsRouter = new Hono<{ Bindings: WorkerEnv }>();

chatCompletionsRouter.post('/chat/completions', async (c) => {
  const traceId = getTraceId(c.req.raw);
  let requestLog: { id: string; startedAt: number } | null = null;
  let concurrencyLease: { leaseId: string; expiresAt: number } | null = null;
  let leaseApiKeyId: string | null = null;

  try {
    const rawBody = await c.req.text();
    const parsed = chatCompletionsRequestSchema.safeParse(JSON.parse(rawBody));

    if (!parsed.success) {
      return c.json({ error: 'Invalid chat completions request', issues: parsed.error.flatten() }, 400, {
        'x-trace-id': traceId,
      });
    }

    const auth = await requireApiKey(c.env, c.req.raw, CHAT_COMPLETIONS_ENDPOINT);
    const channel = await requireActiveGatewayChannel(c.env, auth.channelId);
    concurrencyLease = await acquireConcurrencyLease(c.env, auth.apiKey.id, auth.apiKey.maxConcurrency);
    leaseApiKeyId = auth.apiKey.id;

    if (!concurrencyLease) {
      return c.json({ error: 'API key concurrency limit exceeded' }, 429, {
        'x-trace-id': traceId,
      });
    }

    requestLog = await startRequestLog(c.env, {
      apiKeyId: auth.apiKey.id,
      endpoint: CHAT_COMPLETIONS_ENDPOINT,
      model: parsed.data.model,
      channelId: channel.id,
      traceId,
      rawBody,
    });

    const upstreamResponse = await fetch(`${channel.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-trace-id': traceId,
      },
      body: rawBody,
    });
    const responseBody = await upstreamResponse.text();

    await finishRequestLog(c.env, {
      id: requestLog.id,
      startedAt: requestLog.startedAt,
      status: upstreamResponse.ok ? 'completed' : 'failed',
      httpStatus: upstreamResponse.status,
      responseBody,
    });

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
        'x-trace-id': traceId,
      },
    });
  } catch (error) {
    if (requestLog) {
      await finishRequestLog(c.env, {
        id: requestLog.id,
        startedAt: requestLog.startedAt,
        status: 'failed',
        httpStatus: 502,
        responseBody: null,
      });
    }

    if (error instanceof Response) {
      return error;
    }

    return c.json({ error: 'Gateway request failed' }, 502, {
      'x-trace-id': traceId,
    });
  } finally {
    if (concurrencyLease && leaseApiKeyId) {
      await releaseConcurrencyLease(c.env, leaseApiKeyId, concurrencyLease.leaseId);
    }
  }
});


