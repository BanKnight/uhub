// @ts-nocheck
import {
  assert,
  createChannel,
  ensureAdminSession,
  listChannels,
  updateChannel,
  updateChannelStatus,
  withMockJsonUpstream,
} from './_anthropic';

async function main() {
  await withMockJsonUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      assert(parsed.model === 'gpt-4o-mini', `Unexpected model: ${JSON.stringify(parsed)}`);

      return {
        body: JSON.stringify({
          id: 'chatcmpl-admin-channel-structured-test',
          object: 'chat.completion',
          created: 1710000031,
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'ok',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      };
    },
    async (baseUrl) => {
      const cookie = await ensureAdminSession();
      const name = `admin-structured-${Date.now()}`;
      const channelId = await createChannel(cookie, {
        name,
        provider: 'openai',
        protocol: 'openai_chat_completions',
        baseUrl,
        models: ['gpt-4o-mini'],
      });

      const createdList = await listChannels(cookie);
      const created = createdList.find((item) => item.id === channelId);
      assert(created, `Created channel missing from list: ${JSON.stringify(createdList)}`);
      assert(created.provider === 'openai', `Unexpected provider: ${JSON.stringify(created)}`);
      assert(
        created.protocol === 'openai_chat_completions',
        `Unexpected protocol: ${JSON.stringify(created)}`
      );
      assert(created.baseUrl === baseUrl, `Unexpected baseUrl: ${JSON.stringify(created)}`);
      assert(
        JSON.stringify(created.models) === JSON.stringify(['gpt-4o-mini']),
        `Unexpected models: ${JSON.stringify(created)}`
      );
      assert(
        created.gatewayHealthStatus === 'healthy' && created.gatewayUnhealthyUntil === null,
        `Unexpected gateway health: ${JSON.stringify(created)}`
      );

      const updated = await updateChannel(cookie, {
        id: channelId,
        name: `${name}-updated`,
        provider: 'openai',
        protocol: 'openai_chat_completions',
        baseUrl,
        models: ['gpt-4o-mini', 'gpt-4o'],
        status: 'disabled',
      });

      assert(
        updated.name === `${name}-updated`,
        `Unexpected update response: ${JSON.stringify(updated)}`
      );
      assert(updated.status === 'disabled', `Unexpected update status: ${JSON.stringify(updated)}`);
      assert(
        JSON.stringify(updated.models) === JSON.stringify(['gpt-4o-mini', 'gpt-4o']),
        `Unexpected update models: ${JSON.stringify(updated)}`
      );
      assert(
        updated.gatewayHealthStatus === 'healthy' && updated.gatewayUnhealthyUntil === null,
        `Unexpected update gateway health: ${JSON.stringify(updated)}`
      );

      const updatedList = await listChannels(cookie);
      const updatedFromList = updatedList.find((item) => item.id === channelId);
      assert(updatedFromList, `Updated channel missing from list: ${JSON.stringify(updatedList)}`);
      assert(
        updatedFromList.name === `${name}-updated`,
        `Unexpected listed name: ${JSON.stringify(updatedFromList)}`
      );
      assert(
        updatedFromList.status === 'disabled',
        `Unexpected listed status: ${JSON.stringify(updatedFromList)}`
      );
      assert(
        JSON.stringify(updatedFromList.models) === JSON.stringify(['gpt-4o-mini', 'gpt-4o']),
        `Unexpected listed models: ${JSON.stringify(updatedFromList)}`
      );

      const reactivated = await updateChannelStatus(cookie, {
        id: channelId,
        status: 'active',
      });
      assert(
        reactivated.status === 'active',
        `Unexpected reactivated status response: ${JSON.stringify(reactivated)}`
      );

      const finalList = await listChannels(cookie);
      const reactivatedFromList = finalList.find((item) => item.id === channelId);
      assert(
        reactivatedFromList?.status === 'active',
        `Unexpected reactivated listed status: ${JSON.stringify(reactivatedFromList)}`
      );
      assert(
        reactivatedFromList?.gatewayHealthStatus === 'healthy' &&
          reactivatedFromList?.gatewayUnhealthyUntil === null,
        `Unexpected reactivated gateway health: ${JSON.stringify(reactivatedFromList)}`
      );

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            channelId,
            created,
            updated: updatedFromList,
            reactivated: reactivatedFromList,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
