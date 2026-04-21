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

type ProviderCase = {
  provider: 'openai' | 'anthropic' | 'gemini';
  protocol: 'openai_chat_completions' | 'anthropic_messages' | 'gemini_contents';
  initialModels: string[];
  initialDefaultTestModel: string;
  updatedModels: string[];
  updatedDefaultTestModel: string;
};

const providerCases: ProviderCase[] = [
  {
    provider: 'openai',
    protocol: 'openai_chat_completions',
    initialModels: ['gpt-4o-mini'],
    initialDefaultTestModel: 'gpt-4o-mini',
    updatedModels: ['gpt-4o-mini', 'gpt-4o'],
    updatedDefaultTestModel: 'gpt-4o',
  },
  {
    provider: 'anthropic',
    protocol: 'anthropic_messages',
    initialModels: ['claude-3-5-sonnet-latest'],
    initialDefaultTestModel: 'claude-3-5-sonnet-latest',
    updatedModels: ['claude-3-5-sonnet-latest', 'claude-3-5-sonnet-20241022'],
    updatedDefaultTestModel: 'claude-3-5-sonnet-20241022',
  },
  {
    provider: 'gemini',
    protocol: 'gemini_contents',
    initialModels: ['gemini-2.5-flash'],
    initialDefaultTestModel: 'gemini-2.5-flash',
    updatedModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    updatedDefaultTestModel: 'gemini-2.5-pro',
  },
];

async function verifyProviderCase(
  cookie: string,
  baseUrl: string,
  providerCase: ProviderCase,
  now: number
) {
  const name = `admin-structured-${providerCase.provider}-${now}`;
  const channelId = await createChannel(cookie, {
    name,
    provider: providerCase.provider,
    protocol: providerCase.protocol,
    baseUrl,
    models: providerCase.initialModels,
    defaultTestModel: providerCase.initialDefaultTestModel,
  });

  const createdList = await listChannels(cookie);
  const created = createdList.find((item) => item.id === channelId);
  assert(created, `Created channel missing from list: ${JSON.stringify(createdList)}`);
  assert(created.provider === providerCase.provider, `Unexpected provider: ${JSON.stringify(created)}`);
  assert(created.protocol === providerCase.protocol, `Unexpected protocol: ${JSON.stringify(created)}`);
  assert(created.baseUrl === baseUrl, `Unexpected baseUrl: ${JSON.stringify(created)}`);
  assert(
    JSON.stringify(created.models) === JSON.stringify(providerCase.initialModels),
    `Unexpected models: ${JSON.stringify(created)}`
  );
  assert(
    created.defaultTestModel === providerCase.initialDefaultTestModel,
    `Unexpected defaultTestModel: ${JSON.stringify(created)}`
  );
  assert(
    created.gatewayHealthStatus === 'healthy' && created.gatewayUnhealthyUntil === null,
    `Unexpected gateway health: ${JSON.stringify(created)}`
  );

  const updated = await updateChannel(cookie, {
    id: channelId,
    name: `${name}-updated`,
    provider: providerCase.provider,
    protocol: providerCase.protocol,
    baseUrl,
    models: providerCase.updatedModels,
    defaultTestModel: providerCase.updatedDefaultTestModel,
    status: 'disabled',
  });

  assert(updated.name === `${name}-updated`, `Unexpected update response: ${JSON.stringify(updated)}`);
  assert(updated.status === 'disabled', `Unexpected update status: ${JSON.stringify(updated)}`);
  assert(
    JSON.stringify(updated.models) === JSON.stringify(providerCase.updatedModels),
    `Unexpected update models: ${JSON.stringify(updated)}`
  );
  assert(
    updated.defaultTestModel === providerCase.updatedDefaultTestModel,
    `Unexpected updated defaultTestModel: ${JSON.stringify(updated)}`
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
    updatedFromList.provider === providerCase.provider,
    `Unexpected listed provider: ${JSON.stringify(updatedFromList)}`
  );
  assert(
    updatedFromList.protocol === providerCase.protocol,
    `Unexpected listed protocol: ${JSON.stringify(updatedFromList)}`
  );
  assert(
    JSON.stringify(updatedFromList.models) === JSON.stringify(providerCase.updatedModels),
    `Unexpected listed models: ${JSON.stringify(updatedFromList)}`
  );
  assert(
    updatedFromList.defaultTestModel === providerCase.updatedDefaultTestModel,
    `Unexpected listed defaultTestModel: ${JSON.stringify(updatedFromList)}`
  );

  const cleared = await updateChannel(cookie, {
    id: channelId,
    name: `${name}-cleared`,
    provider: providerCase.provider,
    protocol: providerCase.protocol,
    baseUrl,
    models: providerCase.initialModels,
    defaultTestModel: providerCase.updatedDefaultTestModel,
    status: 'active',
  });
  assert(
    cleared.defaultTestModel === null,
    `Expected defaultTestModel to clear: ${JSON.stringify(cleared)}`
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
    reactivatedFromList?.provider === providerCase.provider,
    `Unexpected reactivated listed provider: ${JSON.stringify(reactivatedFromList)}`
  );
  assert(
    reactivatedFromList?.protocol === providerCase.protocol,
    `Unexpected reactivated listed protocol: ${JSON.stringify(reactivatedFromList)}`
  );
  assert(
    reactivatedFromList?.defaultTestModel === null,
    `Unexpected reactivated defaultTestModel: ${JSON.stringify(reactivatedFromList)}`
  );
  assert(
    reactivatedFromList?.gatewayHealthStatus === 'healthy' &&
      reactivatedFromList?.gatewayUnhealthyUntil === null,
    `Unexpected reactivated gateway health: ${JSON.stringify(reactivatedFromList)}`
  );

  return {
    channelId,
    created,
    updated: updatedFromList,
    reactivated: reactivatedFromList,
  };
}

async function main() {
  await withMockJsonUpstream(
    (body) => {
      const parsed = JSON.parse(body);
      assert(typeof parsed.model === 'string' && parsed.model.length > 0, `Unexpected model: ${JSON.stringify(parsed)}`);

      return {
        body: JSON.stringify({
          id: 'chatcmpl-admin-channel-structured-test',
          object: 'chat.completion',
          created: 1710000031,
          model: parsed.model,
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
      const results = [];

      for (const [index, providerCase] of providerCases.entries()) {
        results.push(await verifyProviderCase(cookie, baseUrl, providerCase, Date.now() + index));
      }

      console.log(
        JSON.stringify(
          {
            status: 'ok',
            providers: results,
          },
          null,
          2
        )
      );
    }
  );
}

await main();
