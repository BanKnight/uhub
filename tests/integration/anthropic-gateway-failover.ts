// @ts-nocheck
import {
  WORKER_BASE_URL,
  assert,
  createApiKey,
  createChannel,
  ensureAdminSession,
  listChannels,
  requestJson,
  withMockJsonUpstream,
} from './_anthropic';

async function callAnthropic(rawKey: string) {
  const response = await fetch(`${WORKER_BASE_URL}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'Say hello with failover' }],
    }),
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

function getChannel(channels: Array<Record<string, unknown>>, channelId: string) {
  const channel = channels.find((item) => item.id === channelId);
  assert(channel, `Channel ${channelId} missing from list: ${JSON.stringify(channels)}`);
  return channel;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  let primaryHits = 0;
  let secondaryHits = 0;

  await withMockJsonUpstream(
    () => {
      primaryHits += 1;
      return {
        status: 503,
        body: JSON.stringify({
          error: {
            message: 'primary unavailable',
          },
        }),
        headers: {
          'content-type': 'application/json',
        },
      };
    },
    async (primaryBaseUrl) => {
      await withMockJsonUpstream(
        (body) => {
          secondaryHits += 1;
          const parsed = JSON.parse(body);
          return {
            body: JSON.stringify({
              id: 'chatcmpl-anthropic-failover-test',
              object: 'chat.completion',
              created: 1710000003,
              model: parsed.model ?? 'gpt-4o-mini',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'served-by-secondary',
                  },
                  finish_reason: 'stop',
                },
              ],
            }),
            headers: {
              'content-type': 'application/json',
            },
          };
        },
        async (secondaryBaseUrl) => {
          const cookie = await ensureAdminSession();
          const primaryChannelName = `anthropic-failover-primary-${Date.now()}`;
          const secondaryChannelName = `anthropic-failover-secondary-${Date.now()}`;
          const primaryChannelId = await createChannel(cookie, {
            name: primaryChannelName,
            provider: 'anthropic',
            protocol: 'anthropic_messages',
            baseUrl: primaryBaseUrl,
          });
          const secondaryChannelId = await createChannel(cookie, {
            name: secondaryChannelName,
            provider: 'anthropic',
            protocol: 'anthropic_messages',
            baseUrl: secondaryBaseUrl,
          });
          const rawKey = await createApiKey(cookie, {
            label: `anthropic-failover-key-${Date.now()}`,
            channelIds: [primaryChannelId, secondaryChannelId],
            endpointRules: ['anthropic_messages'],
          });

          const firstResult = await callAnthropic(rawKey);
          assert(
            firstResult.response.ok,
            `Failover request failed: ${JSON.stringify(firstResult.json)}`
          );
          assert(
            firstResult.response.headers.get('content-type')?.includes('application/json'),
            `Unexpected content-type: ${firstResult.response.headers.get('content-type')}`
          );
          const firstTraceId = firstResult.response.headers.get('x-trace-id');
          assert(firstTraceId, 'Missing x-trace-id header');
          assert(
            firstResult.json?.type === 'message',
            `Unexpected response type: ${JSON.stringify(firstResult.json)}`
          );
          assert(
            firstResult.json?.content?.[0]?.type === 'text' &&
              firstResult.json.content[0].text === 'served-by-secondary',
            `Unexpected failover response body: ${JSON.stringify(firstResult.json)}`
          );
          assert(primaryHits === 1, `Expected primaryHits=1, got ${primaryHits}`);
          assert(secondaryHits === 1, `Expected secondaryHits=1, got ${secondaryHits}`);

          const secondResult = await callAnthropic(rawKey);
          assert(
            secondResult.response.ok,
            `Second failover request failed: ${JSON.stringify(secondResult.json)}`
          );
          assert(
            primaryHits === 1,
            `Primary should stay in cooldown for the second request, got primaryHits=${primaryHits}`
          );
          assert(secondaryHits === 2, `Expected secondaryHits=2, got ${secondaryHits}`);

          const channelsDuringCooldown = await listChannels(cookie);
          const primaryDuringCooldown = getChannel(channelsDuringCooldown, primaryChannelId);
          const secondaryDuringCooldown = getChannel(channelsDuringCooldown, secondaryChannelId);
          assert(
            primaryDuringCooldown.gatewayHealthStatus === 'cooling_down',
            `Unexpected primary gateway health: ${JSON.stringify(primaryDuringCooldown)}`
          );
          assert(
            typeof primaryDuringCooldown.gatewayUnhealthyUntil === 'number' &&
              primaryDuringCooldown.gatewayUnhealthyUntil > Date.now(),
            `Unexpected primary unhealthyUntil: ${JSON.stringify(primaryDuringCooldown)}`
          );
          assert(
            secondaryDuringCooldown.gatewayHealthStatus === 'healthy' &&
              secondaryDuringCooldown.gatewayUnhealthyUntil === null,
            `Unexpected secondary gateway health: ${JSON.stringify(secondaryDuringCooldown)}`
          );

          const audit = await requestJson(
            `/trpc/admin.audit.list?input=${encodeURIComponent(JSON.stringify({ traceId: firstTraceId }))}`,
            { method: 'GET' },
            cookie
          );
          assert(audit.response.ok, `Audit failed: ${JSON.stringify(audit.json)}`);
          const auditItem = audit.json?.result?.data?.[0];
          assert(
            auditItem?.traceId === firstTraceId,
            `Unexpected audit item: ${JSON.stringify(audit.json)}`
          );
          assert(
            auditItem?.endpoint === 'anthropic_messages',
            `Unexpected audit endpoint: ${JSON.stringify(audit.json)}`
          );
          assert(
            auditItem?.status === 'completed',
            `Unexpected audit status: ${JSON.stringify(audit.json)}`
          );
          assert(
            auditItem?.failureClass === null,
            `Unexpected audit failure class: ${JSON.stringify(audit.json)}`
          );
          assert(
            auditItem?.channelId === secondaryChannelId,
            `Unexpected audit channelId: ${JSON.stringify(audit.json)}`
          );
          assert(
            auditItem?.channelName === secondaryChannelName,
            `Unexpected audit channelName: ${JSON.stringify(audit.json)}`
          );
          assert(
            auditItem?.provider === 'anthropic',
            `Unexpected audit provider: ${JSON.stringify(audit.json)}`
          );
          assert(
            auditItem?.httpStatus === 200,
            `Unexpected audit httpStatus: ${JSON.stringify(audit.json)}`
          );

          const waitMs = Math.max(
            0,
            (primaryDuringCooldown.gatewayUnhealthyUntil ?? Date.now()) - Date.now() + 50
          );
          if (waitMs > 0) {
            await sleep(waitMs);
          }

          const channelsAfterRecovery = await listChannels(cookie);
          const primaryAfterRecovery = getChannel(channelsAfterRecovery, primaryChannelId);
          assert(
            primaryAfterRecovery.gatewayHealthStatus === 'healthy' &&
              primaryAfterRecovery.gatewayUnhealthyUntil === null,
            `Unexpected recovered gateway health: ${JSON.stringify(primaryAfterRecovery)}`
          );

          const thirdResult = await callAnthropic(rawKey);
          assert(
            thirdResult.response.ok,
            `Third failover request failed: ${JSON.stringify(thirdResult.json)}`
          );
          assert(
            primaryHits === 2,
            `Primary should be retried after cooldown recovery, got primaryHits=${primaryHits}`
          );
          assert(secondaryHits === 3, `Expected secondaryHits=3, got ${secondaryHits}`);

          const channelsAfterRetry = await listChannels(cookie);
          const primaryAfterRetry = getChannel(channelsAfterRetry, primaryChannelId);
          assert(
            primaryAfterRetry.gatewayHealthStatus === 'cooling_down' &&
              typeof primaryAfterRetry.gatewayUnhealthyUntil === 'number',
            `Unexpected post-retry gateway health: ${JSON.stringify(primaryAfterRetry)}`
          );

          console.log(
            JSON.stringify(
              {
                status: 'ok',
                traceId: firstTraceId,
                primaryHits,
                secondaryHits,
                cooldownUntil: primaryDuringCooldown.gatewayUnhealthyUntil,
                recoveredHealth: primaryAfterRecovery.gatewayHealthStatus,
                text: firstResult.json.content[0].text,
              },
              null,
              2
            )
          );
        }
      );
    }
  );
}

await main();
